import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostControlProvider } from '../types.js';
import { DEFAULT_CAPTURES_DIR } from '../constants/index.js';

const execFileAsync = promisify(execFile);

function osascript(script: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('osascript', ['-e', script], { encoding: 'utf8' });
}

export class MacOsHostControlProvider implements HostControlProvider {
  private readonly captureDir = path.resolve(process.cwd(), DEFAULT_CAPTURES_DIR);

  async getStatus() {
    const uptime = await execFileAsync('bash', ['-lc', 'uptime | sed "s/^.*up //"'], {
      encoding: 'utf8',
    });
    return {
      hostname: os.hostname(),
      user: os.userInfo().username,
      cwd: process.cwd(),
      uptime: uptime.stdout.trim(),
      platform: `${os.platform()} ${os.release()}`,
    };
  }

  async openUrl({ url }: { url: string }) {
    await execFileAsync('open', [url]);
    return { opened: url };
  }

  async openApp({ command, args = [] }: { command: string; args?: string[] }) {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { launched: command, args };
  }

  async captureScreen() {
    await fs.mkdir(this.captureDir, { recursive: true });
    const filePath = path.join(this.captureDir, `capture-${Date.now()}.png`);
    await execFileAsync('screencapture', ['-x', filePath]);
    return { path: filePath };
  }

  async listWindows() {
    const result = await osascript(
      'tell application "System Events" to get the name of every process whose visible is true',
    );
    const windows = result.stdout
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map((title, index) => ({ id: String(index + 1), title }));
    return { windows };
  }

  async focusWindow({ windowId }: { windowId: string }) {
    const windows = await this.listWindows();
    const target = windows.windows.find(item => item.id === windowId);
    if (!target?.title) throw new Error(`Window ${windowId} not found`);
    await osascript(`tell application "${target.title}" to activate`);
    return { focused: windowId };
  }

  async readClipboard() {
    const result = await execFileAsync('pbpaste', [], { encoding: 'utf8' });
    return { text: result.stdout };
  }

  async writeClipboard({ text }: { text: string }) {
    await execFileAsync('bash', ['-lc', `printf %s ${JSON.stringify(text)} | pbcopy`]);
    return { written: true };
  }

  async notify({ title, body = '' }: { title: string; body?: string }) {
    const escapedTitle = JSON.stringify(title);
    const escapedBody = JSON.stringify(body);
    await osascript(`display notification ${escapedBody} with title ${escapedTitle}`);
    return { notified: true };
  }
}
