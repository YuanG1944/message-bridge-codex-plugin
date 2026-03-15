import fs from 'node:fs';
import path from 'node:path';
import type { LoggerFields, LoggerLike, LoggerOptions, LogLevel } from './types.js';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_BADGES: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

const MODULE_BADGES: Array<[prefix: string, badge: string, label: string]> = [
  ['bridge.', '🌉', 'BRIDGE'],
  ['feishu.', '🪽', 'FEISHU'],
  ['codex.app-server.', '🤖', 'CODEX'],
  ['codex.sdk.', '🧠', 'SDK'],
  ['codex.', '🤖', 'CODEX'],
];

function normalizeLevel(level: string | undefined): LogLevel {
  return LEVELS.includes(level as LogLevel) ? (level as LogLevel) : 'info';
}

function shortTime(ts: string): string {
  return ts.slice(11, 19);
}

function findModuleMeta(message: string): { badge: string; label: string } {
  for (const [prefix, badge, label] of MODULE_BADGES) {
    if (message.startsWith(prefix)) return { badge, label };
  }
  return { badge: '🧩', label: 'APP' };
}

function humanizeEvent(message: string): string {
  const map: Record<string, string> = {
    'bridge.started': 'Bridge started',
    'bridge.incoming': 'Incoming message',
    'bridge.thread_missing_recreate': 'Thread missing, recreating',
    'bridge.runtime_recovering': 'Recovering runtime after disconnect',
    'bridge.runtime_recover_stop_failed': 'Runtime stop during recovery failed',
    'bridge.runtime_recover_start_failed': 'Runtime start during recovery failed',
    'bridge.runtime_recover_notify_failed': 'Failed to notify chat during runtime recovery',
    'bridge.handle_envelope_error_notify_failed': 'Failed to send envelope error to chat',
    'bridge.flush_turn_error_notify_failed': 'Failed to send turn flush error to chat',
    'feishu.webhook.started': 'Webhook server listening',
    'feishu.websocket.started': 'WebSocket client connected',
    'feishu.webhook.error': 'Webhook handling failed',
    'feishu.api.request': 'Feishu API request',
    'feishu.api.response': 'Feishu API response',
    'feishu.api.error': 'Feishu API error',
    'feishu.reaction.add_failed': 'Failed to add reaction',
    'feishu.reaction.remove_failed': 'Failed to remove reaction',
    'codex.server_request': 'Codex requested user action',
    'codex.notification': 'Codex notification',
    'codex.notification.incoming': 'Codex notification incoming',
    'codex.request.incoming': 'Codex request incoming',
    'codex.notification.unhandled': 'Unhandled Codex notification',
    'codex.sdk.runOnce': 'SDK one-shot task completed',
    'codex.app-server.stdout': 'App server stdout',
    'codex.app-server.stderr': 'App server stderr',
    'codex.app-server.starting': 'Starting app server',
    'codex.app-server.ready': 'App server ready',
    'codex.app-server.socket_open': 'App server socket connected',
    'codex.app-server.spawn_error': 'App server failed to spawn',
    'codex.app-server.exit': 'App server exited',
    'codex.app-server.socket_error': 'App server socket error',
    'codex.app-server.socket_runtime_error': 'App server runtime error',
    'codex.app-server.socket_closed': 'App server socket closed',
  };
  return map[message] || message.replace(/[._]/g, ' ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  } catch {
    return String(value);
  }
}

function pickImportantFields(extra: unknown): Array<[string, string]> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return [];
  const record = extra as Record<string, unknown>;
  const keys = [
    'type',
    'method',
    'chatId',
    'chatType',
    'senderId',
    'messageId',
    'threadId',
    'turnId',
    'processId',
    'port',
    'listenUrl',
    'url',
    'mode',
    'binary',
    'cwd',
    'transport',
    'attempt',
    'callback_url',
    'sandbox_mode',
    'approval_policy',
    'code',
    'signal',
    'error',
    'codexCwd',
    'accepted_paths',
  ];
  const out: Array<[string, string]> = [];
  for (const key of keys) {
    if (!(key in record)) continue;
    const rendered = formatValue(record[key]);
    if (!rendered) continue;
    out.push([key, rendered]);
  }
  return out;
}

function formatStdoutLine(params: {
  ts: string;
  level: LogLevel;
  message: string;
  extra?: unknown;
}): string {
  const { ts, level, message, extra } = params;
  const { badge, label } = findModuleMeta(message);
  const title = humanizeEvent(message);
  const important = pickImportantFields(extra);
  const parts = [`${shortTime(ts)}`, LEVEL_BADGES[level], `${badge} ${label}`, title];
  if (important.length) {
    parts.push(
      important
        .map(([key, value]) => `${key}=${value}`)
        .join(' | '),
    );
  } else if (typeof extra === 'string' && extra.trim()) {
    parts.push(formatValue(extra));
  }
  return parts.join('  ');
}

export class Logger implements LoggerLike, LoggerFields {
  level: LogLevel;
  stdout: boolean;
  filePath: string;
  stream: fs.WriteStream | null;

  constructor(options: LoggerOptions = {}) {
    this.level = normalizeLevel(options.level || process.env.BRIDGE_LOG_LEVEL);
    this.stdout = options.stdout !== false;
    this.filePath = options.filePath || '';
    this.stream = null;

    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS.indexOf(level) >= LEVELS.indexOf(this.level);
  }

  private write(level: LogLevel, message: string, extra?: unknown): void {
    if (!this.shouldLog(level)) return;

    const ts = new Date().toISOString();
    const line = JSON.stringify({
      ts,
      level,
      message,
      extra: extra === undefined ? null : extra,
    });

    if (this.stdout) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](formatStdoutLine({ ts, level, message, extra }));
    }

    this.stream?.write(`${line}\n`);
  }

  debug(message: string, extra?: unknown): void {
    this.write('debug', message, extra);
  }

  info(message: string, extra?: unknown): void {
    this.write('info', message, extra);
  }

  warn(message: string, extra?: unknown): void {
    this.write('warn', message, extra);
  }

  error(message: string, extra?: unknown): void {
    this.write('error', message, extra);
  }
}

export function createLogger(options: LoggerOptions = {}): LoggerLike {
  return new Logger(options);
}
