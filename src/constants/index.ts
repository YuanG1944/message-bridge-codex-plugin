export const APP_NAME = 'message-bridge-codex-plugin';
export const APP_VERSION = '0.1.0';

export const DEFAULT_FEISHU_CALLBACK_URL = 'http://127.0.0.1:18080';
export const DEFAULT_FEISHU_CALLBACK_PORT = 18080;

export const DEFAULT_CONFIG_CANDIDATES = [
  process.env.BRIDGE_CONFIG_PATH,
  'bridge.config.local.json',
  'bridge.config.json',
].filter((value): value is string => Boolean(value));

export const DEFAULT_LOG_FILE = './logs/bridge.log';
export const DEFAULT_DATABASE_PATH = './data/bridge.db';
export const DEFAULT_FILES_DIR = './data/files';
export const DEFAULT_CAPTURES_DIR = './data/captures';

export const DEFAULT_CODEX_MODEL = null;
export const DEFAULT_SANDBOX_MODE = 'workspace-write';
export const DEFAULT_APPROVAL_POLICY = 'on-request';
export const DEFAULT_RUNTIME = 'app-server';
export const DEFAULT_CARD_UPDATE_INTERVAL_MS = 600;

export const DEFAULT_SAFE_HOST_TOOLS = [
  'host.get_status',
  'host.open_url',
  'host.open_app',
  'host.capture_screen',
  'host.list_windows',
  'host.focus_window',
  'host.read_clipboard',
  'host.write_clipboard',
  'host.notify',
] as const;

export const DEFAULT_DANGER_HOST_TOOLS = [
  'host.keypress',
  'host.mouse',
  'host.shutdown',
  'host.reboot',
  'host.sleep',
] as const;

export const DEFAULT_STATUS_TEXT = 'Running';

export const BRIDGE_COMMANDS = [
  '/help',
  '/new',
  '/threads',
  '/switch <index|id>',
  '/fork',
  '/compact',
  '/interrupt',
  '/review [current|<sha>|branch <name>|<instructions>]',
  '/model [index|id]',
  '/plan [on|off|status]',
  '/workspace [id]',
  '/cwd [path]',
  '/status',
  '/actions',
  '/run <name>',
  '/approve once|session',
  '/deny',
  '/cancel',
  '/sendfile <path>',
  '/savefile',
  '/cache [status|prune|clear]',
  '/host status|tools',
] as const;
