import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_CONFIG_CANDIDATES,
  DEFAULT_SAFE_HOST_TOOLS,
  DEFAULT_SANDBOX_MODE,
} from './constants/index.js';
import type {
  ApprovalPolicy,
  BridgeConfig,
  HostControlConfig,
  SandboxMode,
  SlashCommand,
  WorkspaceProfile,
} from './types.js';

export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function parseSlashCommand(input: string): SlashCommand | null {
  const text = String(input || '')
    .trim()
    // Group chats often prefix commands with mentions like "@codex /help".
    .replace(/^(?:@\S+\s+)+/, '')
    .trim();
  if (!text.startsWith('/')) return null;
  const body = text.slice(1).trim();
  if (!body) return null;
  const firstSpace = body.indexOf(' ');
  if (firstSpace === -1) {
    return { command: body.toLowerCase(), args: '' };
  }
  return {
    command: body.slice(0, firstSpace).toLowerCase(),
    args: body.slice(firstSpace + 1).trim(),
  };
}

export function splitShellLikeArgs(input: string): string[] {
  const text = String(input || '').trim();
  if (!text) return [];

  const out: string[] = [];
  let current = '';
  let quote = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] || '';
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) out.push(current);
  return out;
}

export function resolveMaybeRelative(baseDir: string, value: string): string {
  if (!value) return value;
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

export function pickConfigPath(cwd = process.cwd()): string {
  for (const candidate of DEFAULT_CONFIG_CANDIDATES) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return '';
}

export function ensureWorkspaceProfiles(config: BridgeConfig): WorkspaceProfile[] {
  if (config.workspaces.length > 0) return config.workspaces;
  return [
    {
      id: 'default',
      name: 'Default Workspace',
      cwd: config.codex.cwd,
      additional_directories: [...config.codex.workspace_roots],
      default_model: config.codex.model,
      web_search: config.codex.web_search,
    },
  ];
}

export function isAllowedCwd(
  targetCwd: string,
  workspaceRoots: string[],
  allowFreeCwd: boolean,
): boolean {
  if (allowFreeCwd) return true;
  const normalized = path.resolve(targetCwd);
  return workspaceRoots.some(root => {
    const resolved = path.resolve(root);
    return normalized === resolved || normalized.startsWith(`${resolved}${path.sep}`);
  });
}

export function parseApprovalPolicy(value: string | undefined): ApprovalPolicy {
  return value === 'never' ||
    value === 'on-request' ||
    value === 'on-failure' ||
    value === 'untrusted'
    ? value
    : DEFAULT_APPROVAL_POLICY;
}

export function parseSandboxMode(value: string | undefined): SandboxMode {
  return value === 'read-only' ||
    value === 'workspace-write' ||
    value === 'danger-full-access'
    ? value
    : DEFAULT_SANDBOX_MODE;
}

export function defaultHostControlConfig(): HostControlConfig {
  return {
    enabled: true,
    provider: 'auto',
    allowed_tools: [...DEFAULT_SAFE_HOST_TOOLS],
    danger_tools: [],
  };
}

export function sanitizeTemplateMarkers(text: string): string {
  return String(text || '')
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }');
}

export function sanitizeLarkMdForCard(text: string): string {
  const input = String(text || '').replace(/\r\n/g, '\n');
  const lines = input.split('\n');
  const output: string[] = [];
  let inFence = false;
  let fenceLen = 3;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,})/);

    if (!inFence) {
      if (fenceMatch) {
        inFence = true;
        fenceLen = fenceMatch[1]?.length || 3;
      }
      output.push(sanitizeTemplateMarkers(line));
      continue;
    }

    if (fenceMatch && (fenceMatch[1]?.length || 0) >= fenceLen) {
      inFence = false;
      output.push(sanitizeTemplateMarkers(line));
      continue;
    }

    output.push(line.replace(/\{/g, '｛').replace(/\}/g, '｝'));
  }

  if (inFence) output.push('```');
  return output.join('\n');
}

export function createTextInput(text: string): {
  type: 'text';
  text: string;
  text_elements: Array<Record<string, unknown>>;
} {
  return { type: 'text', text, text_elements: [] };
}

export async function findAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate port'));
        return;
      }
      const port = address.port;
      server.close(err => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}
