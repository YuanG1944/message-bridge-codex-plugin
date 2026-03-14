import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CONFIG_CANDIDATES,
  DEFAULT_DATABASE_PATH,
  DEFAULT_FEISHU_CALLBACK_URL,
  DEFAULT_FEISHU_CALLBACK_PORT,
  DEFAULT_FILES_DIR,
  DEFAULT_LOG_FILE,
  DEFAULT_RUNTIME,
} from './constants/index.js';
import type { BridgeAction, BridgeConfig, WorkspaceProfile } from './types.js';
import {
  defaultHostControlConfig,
  parseApprovalPolicy,
  parseSandboxMode,
  pickConfigPath,
  resolveMaybeRelative,
} from './utils.js';

function asArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readConfigFile(cwd = process.cwd()): { path: string; value: Record<string, unknown> } {
  const picked = pickConfigPath(cwd);
  if (picked) {
    return {
      path: picked,
      value: JSON.parse(fs.readFileSync(picked, 'utf8')) as Record<string, unknown>,
    };
  }

  for (const candidate of DEFAULT_CONFIG_CANDIDATES) {
    const resolved = path.resolve(cwd, candidate);
    if (!fs.existsSync(resolved)) continue;
    return {
      path: resolved,
      value: JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<string, unknown>,
    };
  }

  return { path: '', value: {} };
}

function normalizeWorkspace(raw: unknown, index: number, baseDir: string, fallbackCwd: string): WorkspaceProfile | null {
  const item = asObject(raw);
  const id = asString(item.id) || `workspace-${index + 1}`;
  const cwd = resolveMaybeRelative(baseDir, asString(item.cwd) || fallbackCwd);
  if (!cwd) return null;
  return {
    id,
    name: asString(item.name) || id,
    cwd,
    additional_directories: asArray<string>(item.additional_directories)
      .map(entry => resolveMaybeRelative(baseDir, String(entry)))
      .filter(Boolean),
    default_model: asString(item.default_model || item.model) || null,
    web_search: asBoolean(item.web_search),
  };
}

function normalizeAction(raw: unknown, baseDir: string, fallbackCwd: string): BridgeAction | null {
  const item = asObject(raw);
  const name = asString(item.name);
  const command = asArray<string>(item.command).map(value => String(value));
  if (!name || command.length === 0) return null;
  return {
    name,
    command,
    cwd: resolveMaybeRelative(baseDir, asString(item.cwd) || fallbackCwd),
    require_approval: item.require_approval !== false,
    allow_network: asBoolean(item.allow_network),
  };
}

export function loadConfig(cwd = process.cwd()): BridgeConfig {
  const { path: configPath, value } = readConfigFile(cwd);
  const baseDir = configPath ? path.dirname(configPath) : cwd;

  const feishu = asObject(value.feishu);
  const codex = asObject(value.codex);
  const security = asObject(value.security);
  const hostControl = { ...defaultHostControlConfig(), ...asObject(value.host_control) };
  const storage = asObject(value.storage);

  const fallbackCwd = resolveMaybeRelative(
    baseDir,
    asString(codex.cwd) || process.env.CODEX_CWD || cwd,
  );
  const workspaceRoots = asArray<string>(codex.workspace_roots, [fallbackCwd]).map(item =>
    resolveMaybeRelative(baseDir, String(item)),
  );

  const workspaces = asArray(value.workspaces)
    .map((item, index) => normalizeWorkspace(item, index, baseDir, fallbackCwd))
    .filter((item): item is WorkspaceProfile => item !== null);

  const actions = asArray(value.actions)
    .map(item => normalizeAction(item, baseDir, fallbackCwd))
    .filter((item): item is BridgeAction => item !== null);

  const normalized: BridgeConfig = {
    configPath,
    baseDir,
    feishu: {
      app_id: asString(feishu.app_id) || process.env.FEISHU_APP_ID || '',
      app_secret: asString(feishu.app_secret) || process.env.FEISHU_APP_SECRET || '',
      mode: feishu.mode === 'webhook' ? 'webhook' : 'ws',
      port: asNumber(
        feishu.port,
        Number(process.env.FEISHU_PORT) || DEFAULT_FEISHU_CALLBACK_PORT,
      ),
      callback_url:
        asString(feishu.callback_url) || process.env.FEISHU_CALLBACK_URL || DEFAULT_FEISHU_CALLBACK_URL,
      encrypt_key: asString(feishu.encrypt_key) || process.env.FEISHU_ENCRYPT_KEY || '',
      verification_token:
        asString(feishu.verification_token) || process.env.FEISHU_VERIFICATION_TOKEN || '',
      signing_secret:
        asString(feishu.signing_secret) || process.env.FEISHU_SIGNING_SECRET || '',
    },
    codex: {
      runtime:
        (asString(codex.runtime) as BridgeConfig['codex']['runtime']) || DEFAULT_RUNTIME,
      binary_path: asString(codex.binary_path) || process.env.CODEX_BINARY_PATH || 'codex',
      model: asString(codex.model) || process.env.CODEX_MODEL || null,
      cwd: fallbackCwd,
      sandbox_mode: parseSandboxMode(asString(codex.sandbox_mode)),
      approval_policy: parseApprovalPolicy(asString(codex.approval_policy)),
      workspace_roots: workspaceRoots,
      allow_free_cwd: asBoolean(codex.allow_free_cwd),
      network_access: asBoolean(codex.network_access),
      web_search: asBoolean(codex.web_search),
    },
    security: {
      allowed_sender_ids: asArray<string>(security.allowed_sender_ids).map(String),
      enable_trusted_senders: asBoolean(security.enable_trusted_senders),
      enable_host_danger_tools: asBoolean(security.enable_host_danger_tools),
    },
    workspaces,
    host_control: {
      enabled: hostControl.enabled !== false,
      provider:
        hostControl.provider === 'linux' || hostControl.provider === 'macos'
          ? hostControl.provider
          : 'auto',
      allowed_tools: asArray<string>(hostControl.allowed_tools).map(String),
      danger_tools: asArray<string>(hostControl.danger_tools).map(String),
    },
    actions,
    storage: {
      database_path: resolveMaybeRelative(
        baseDir,
        asString(storage.database_path) || DEFAULT_DATABASE_PATH,
      ),
      files_dir: resolveMaybeRelative(baseDir, asString(storage.files_dir) || DEFAULT_FILES_DIR),
      log_file: resolveMaybeRelative(baseDir, asString(storage.log_file) || DEFAULT_LOG_FILE),
    },
  };

  if (!normalized.feishu.app_id || !normalized.feishu.app_secret) {
    throw new Error('Missing Feishu app_id/app_secret in bridge config.');
  }

  return normalized;
}
