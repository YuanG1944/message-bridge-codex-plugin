import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.BRIDGE_CONFIG_PATH;
});

describe('loadConfig', () => {
  test('loads bridge config with codex-first defaults and resolved paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bridge-config-'));
    tempDirs.push(dir);

    fs.writeFileSync(
      path.join(dir, 'bridge.config.json'),
      JSON.stringify(
        {
          feishu: {
            app_id: 'cli_app',
            app_secret: 'cli_secret',
            port: 19090,
          },
          codex: {
            cwd: './workspace',
            workspace_roots: ['./workspace', './shared'],
          },
          workspaces: [
            {
              id: 'project-a',
              name: 'Project A',
              cwd: './workspace',
              additional_directories: ['./shared'],
            },
          ],
          actions: [
            {
              name: 'status',
              command: ['git', 'status'],
            },
          ],
          storage: {
            database_path: './data/test.db',
            files_dir: './uploads',
            log_file: './logs/test.log',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadConfig(dir);

    expect(config.codex.runtime).toBe('app-server');
    expect(config.feishu.port).toBe(19090);
    expect(config.codex.sandbox_mode).toBe('workspace-write');
    expect(config.codex.approval_policy).toBe('on-request');
    expect(config.codex.cwd).toBe(path.join(dir, 'workspace'));
    expect(config.codex.workspace_roots).toEqual([
      path.join(dir, 'workspace'),
      path.join(dir, 'shared'),
    ]);
    expect(config.workspaces[0]).toEqual({
      id: 'project-a',
      name: 'Project A',
      cwd: path.join(dir, 'workspace'),
      additional_directories: [path.join(dir, 'shared')],
      default_model: null,
      web_search: false,
    });
    expect(config.actions[0]).toEqual({
      name: 'status',
      command: ['git', 'status'],
      cwd: path.join(dir, 'workspace'),
      require_approval: true,
      allow_network: false,
    });
    expect(config.storage.database_path).toBe(path.join(dir, 'data', 'test.db'));
    expect(config.storage.files_dir).toBe(path.join(dir, 'uploads'));
    expect(config.storage.log_file).toBe(path.join(dir, 'logs', 'test.log'));
    expect(config.host_control.enabled).toBe(true);
    expect(config.host_control.allowed_tools).toContain('host.get_status');
  });
});
