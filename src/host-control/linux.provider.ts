import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostControlProvider } from '../types.js';
import { DEFAULT_CAPTURES_DIR } from '../constants/index.js';

const execFileAsync = promisify(execFile);

async function maybeExec(command: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8' });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof Error) return { stdout: '', stderr: error.message };
    return { stdout: '', stderr: String(error) };
  }
}

async function commandExists(command: string): Promise<boolean> {
  const result = await maybeExec('bash', ['-lc', `command -v ${command}`]);
  return Boolean(result.stdout.trim());
}

export class LinuxHostControlProvider implements HostControlProvider {
  private readonly captureDir = path.resolve(process.cwd(), DEFAULT_CAPTURES_DIR);

  async getStatus() {
    const [hostname, user, pwd, uptime] = await Promise.all([
      Promise.resolve(os.hostname()),
      Promise.resolve(os.userInfo().username),
      Promise.resolve(process.cwd()),
      maybeExec('bash', ['-lc', 'uptime -p || true']),
    ]);

    return {
      hostname,
      user,
      cwd: pwd,
      uptime: uptime.stdout.trim(),
      platform: `${os.platform()} ${os.release()}`,
    };
  }

  async openUrl({ url }: { url: string }) {
    await execFileAsync('xdg-open', [url]);
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

    if (await commandExists('gnome-screenshot')) {
      await execFileAsync('gnome-screenshot', ['-f', filePath]);
      return { path: filePath };
    }
    if (await commandExists('grim')) {
      await execFileAsync('grim', [filePath]);
      return { path: filePath };
    }
    if (await commandExists('import')) {
      await execFileAsync('import', ['-window', 'root', filePath]);
      return { path: filePath };
    }
    throw new Error('No screenshot tool found (expected gnome-screenshot, grim, or import).');
  }

  async listWindows() {
    if (!(await commandExists('wmctrl'))) return { windows: [] };
    const result = await execFileAsync('wmctrl', ['-lx'], { encoding: 'utf8' });
    const windows = result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/, 5);
        return {
          id: parts[0] || '',
          desktop: parts[1],
          host: parts[2],
          klass: parts[3],
          title: parts[4] || '',
        };
      });
    return { windows };
  }

  async focusWindow({ windowId }: { windowId: string }) {
    await execFileAsync('wmctrl', ['-ia', windowId]);
    return { focused: windowId };
  }

  async readClipboard() {
    if (await commandExists('wl-paste')) {
      const result = await execFileAsync('wl-paste', ['--no-newline'], { encoding: 'utf8' });
      return { text: result.stdout };
    }
    if (await commandExists('xclip')) {
      const result = await execFileAsync('xclip', ['-o', '-selection', 'clipboard'], {
        encoding: 'utf8',
      });
      return { text: result.stdout };
    }
    throw new Error('No clipboard reader found (expected wl-paste or xclip).');
  }

  async writeClipboard({ text }: { text: string }) {
    const quoted = JSON.stringify(text);
    if (await commandExists('wl-copy')) {
      await execFileAsync('bash', ['-lc', `printf %s ${quoted} | wl-copy`]);
      return { written: true };
    }
    if (await commandExists('xclip')) {
      await execFileAsync('bash', ['-lc', `printf %s ${quoted} | xclip -selection clipboard`]);
      return { written: true };
    }
    throw new Error('No clipboard writer found (expected wl-copy or xclip).');
  }

  async notify({ title, body = '' }: { title: string; body?: string }) {
    if (await commandExists('notify-send')) {
      await execFileAsync('notify-send', [title, body]);
      return { notified: true };
    }
    return { notified: false, reason: 'notify-send not found' };
  }
}
