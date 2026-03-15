import { EventEmitter } from 'node:events';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import NodeWebSocket from 'ws';
import type {
  BridgeConfig,
  CodexModel,
  CodexRuntimeClient,
  CodexThread,
  CodexTurn,
  CommandExecArgs,
  CommandExecResult,
  JsonRpcFailure,
  LoggerLike,
  ReviewResult,
  ReviewTarget,
  ServerNotificationMessage,
  ServerRequestMessage,
  StartThreadArgs,
  StartTurnArgs,
  SteerTurnArgs,
} from '../../types.js';
import { findAvailablePort } from '../../utils.js';
import { writeJson } from '../../utils/fs.js';
import { writeProjectCodexConfig } from './project-config.js';

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type AppServerSocket = NodeWebSocket | WebSocket;

function toError(value: unknown, fallback = 'Unknown websocket error'): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') {
    const message =
      typeof (value as { message?: unknown }).message === 'string'
        ? (value as { message: string }).message
        : typeof (value as { error?: { message?: unknown } }).error?.message === 'string'
          ? String((value as { error: { message: string } }).error.message)
          : fallback;
    return new Error(message);
  }
  return new Error(typeof value === 'string' ? value : fallback);
}

function extractJsonRpcError(message: JsonRpcFailure): Error {
  return new Error(message.error?.message || 'Unknown app-server error');
}

function normalizeThread(raw: Record<string, unknown>): CodexThread {
  return {
    id: String(raw.id || ''),
    preview: String(raw.preview || raw.name || raw.id || ''),
    name: typeof raw.name === 'string' ? raw.name : null,
    cwd: String(raw.cwd || process.cwd()),
    status: typeof raw.status === 'string' ? raw.status : undefined,
  };
}

function normalizeTurn(raw: Record<string, unknown>): CodexTurn {
  return {
    id: String(raw.id || ''),
    status: String(raw.status || 'unknown'),
    items: Array.isArray(raw.items) ? raw.items : undefined,
    error:
      raw.error && typeof raw.error === 'object'
        ? ({ message: String((raw.error as Record<string, unknown>).message || '') } as {
            message?: string;
          })
        : null,
  };
}

function toThreadStartConfig(
  config: BridgeConfig,
  args: StartThreadArgs,
): Record<string, unknown> {
  return {
    cwd: args.cwd,
    model: args.model ?? config.codex.model ?? undefined,
    approvalPolicy: config.codex.approval_policy,
    sandbox: config.codex.sandbox_mode,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  };
}

export class CodexAppServerClient
  extends EventEmitter
  implements CodexRuntimeClient
{
  private static readonly SOCKET_HEARTBEAT_MS = 10_000;
  readonly config: BridgeConfig;
  readonly logger: LoggerLike;
  readonly repoRoot: string;

  child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  socket: AppServerSocket | null = null;
  requestId = 0;
  ready = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private missedHeartbeats = 0;

  private readonly pending = new Map<string | number, PendingResolver>();

  constructor(input: { config: BridgeConfig; logger: LoggerLike; repoRoot: string }) {
    super();
    this.config = input.config;
    this.logger = input.logger;
    this.repoRoot = input.repoRoot;
  }

  async start(): Promise<void> {
    if (this.ready) return;

    const hostControlConfigPath = path.join(this.repoRoot, 'data', 'host-control.runtime.json');
    await writeJson(hostControlConfigPath, {
      allowed_tools: this.config.host_control.allowed_tools,
      danger_tools: this.config.host_control.danger_tools,
      enable_danger_tools: this.config.security.enable_host_danger_tools,
    });
    await writeProjectCodexConfig({
      repoRoot: this.repoRoot,
      hostControlConfigPath,
    });

    const port = await findAvailablePort();
    const listenUrl = `ws://127.0.0.1:${port}`;
    const command = this.config.codex.binary_path;
    const args = [
      'app-server',
      '--listen',
      listenUrl,
      '-c',
      `approval_policy="${this.config.codex.approval_policy}"`,
      '-c',
      `sandbox_mode="${this.config.codex.sandbox_mode}"`,
      '-c',
      `sandbox_workspace_write.network_access=${this.config.codex.network_access}`,
      '-c',
      `web_search="${this.config.codex.web_search ? 'live' : 'disabled'}"`,
    ];

    this.logger.info('codex.app-server.starting', {
      listenUrl,
      cwd: this.repoRoot,
      binary: command,
      sandbox_mode: this.config.codex.sandbox_mode,
      approval_policy: this.config.codex.approval_policy,
    });

    const child = spawn(command, args, {
      cwd: this.repoRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) this.logger.debug('codex.app-server.stdout', text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) this.logger.info('codex.app-server.stderr', text);
    });
    child.on('error', (error: Error) => {
      this.logger.error('codex.app-server.spawn_error', String(error.stack || error));
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.ready = false;
      this.logger.warn('codex.app-server.exit', { code, signal });
    });

    await this.connectWebSocket(listenUrl);
    await this.request('initialize', {
      clientInfo: { name: 'message-bridge-feishu', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.notify('initialized');
    this.ready = true;
    this.logger.info('codex.app-server.ready', { listenUrl });
  }

  async stop(): Promise<void> {
    this.ready = false;
    this.clearHeartbeat();
    this.rejectAllPending(new Error('Codex app-server stopped'));
    if (this.socket) {
      const socket = this.socket;
      if (this.isNodeWebSocket(socket)) {
        socket.removeAllListeners();
      }
      socket.close();
      this.socket = null;
    }
    if (this.child && !this.child.killed) {
      const child = this.child;
      child.kill();
      this.child = null;
    }
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.missedHeartbeats = 0;
  }

  private startHeartbeat(socket: NodeWebSocket): void {
    this.clearHeartbeat();
    this.missedHeartbeats = 0;
    socket.on('pong', () => {
      this.missedHeartbeats = 0;
    });
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== NodeWebSocket.OPEN) {
        this.clearHeartbeat();
        return;
      }
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats > 2) {
        this.logger.warn('codex.app-server.socket_runtime_error', 'Heartbeat timeout');
        socket.terminate();
        this.clearHeartbeat();
        return;
      }
      try {
        socket.ping();
      } catch {
        socket.terminate();
        this.clearHeartbeat();
      }
    }, CodexAppServerClient.SOCKET_HEARTBEAT_MS);
  }

  private rejectAllPending(error: Error): void {
    if (this.pending.size === 0) return;
    for (const [, resolver] of this.pending) {
      resolver.reject(error);
    }
    this.pending.clear();
  }

  private async connectWebSocket(url: string): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        if (process.versions.bun && typeof globalThis.WebSocket === 'function') {
          await this.connectWithNativeWebSocket(url, attempt);
        } else {
          await this.connectWithNodeWebSocket(url, attempt);
        }
        return;
      } catch (error) {
        lastError = toError(error);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    throw lastError || new Error('Failed to connect to codex app-server websocket');
  }

  private connectWithNodeWebSocket(url: string, attempt: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new NodeWebSocket(url);
      this.socket = socket;
      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error(`Timed out connecting to ${url}`));
      }, 5_000);

      const fail = (error: unknown) => {
        const normalized = toError(error);
        this.logger.debug('codex.app-server.socket_error', {
          attempt: attempt + 1,
          message: normalized.message,
        });
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners('open');
        socket.removeAllListeners('message');
        socket.removeAllListeners('close');
        socket.removeAllListeners('error');
        reject(normalized);
      };

      socket.once('open', () => {
        settled = true;
        clearTimeout(timer);
        this.logger.info('codex.app-server.socket_open', {
          transport: 'ws',
          attempt: attempt + 1,
          url,
        });
        this.startHeartbeat(socket);
        socket.on('message', (data: NodeWebSocket.RawData) => this.handleMessage(data.toString()));
        socket.on('close', (code, reason) => {
          this.onSocketClosed(code, reason.toString());
        });
        socket.on('error', (error: unknown) => {
          const normalized = toError(error);
          this.ready = false;
          this.logger.error('codex.app-server.socket_runtime_error', normalized.message);
        });
        resolve();
      });
      socket.once('error', fail);
    });
  }

  private connectWithNativeWebSocket(url: string, attempt: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new globalThis.WebSocket(url);
      this.socket = socket;
      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error(`Timed out connecting to ${url}`));
      }, 5_000);

      const fail = (error: unknown) => {
        const normalized = toError(error);
        this.logger.debug('codex.app-server.socket_error', {
          attempt: attempt + 1,
          message: normalized.message,
        });
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        reject(normalized);
      };

      socket.onopen = () => {
        settled = true;
        clearTimeout(timer);
        this.logger.info('codex.app-server.socket_open', {
          transport: 'native',
          attempt: attempt + 1,
          url,
        });
        socket.onmessage = event => {
          if (typeof event.data === 'string') {
            this.handleMessage(event.data);
            return;
          }
          if (event.data instanceof ArrayBuffer) {
            this.handleMessage(Buffer.from(event.data).toString('utf8'));
            return;
          }
          this.handleMessage(String(event.data));
        };
        socket.onclose = event => {
          this.onSocketClosed(event.code, event.reason);
        };
        socket.onerror = event => {
          const normalized = toError(
            (event as unknown as { error?: unknown }).error,
            `WebSocket connection to '${url}' failed`,
          );
          this.ready = false;
          this.logger.error('codex.app-server.socket_runtime_error', normalized.message);
        };
        resolve();
      };

      socket.onerror = event => {
        fail(
          (event as unknown as { error?: unknown }).error ||
            new Error(`WebSocket connection to '${url}' failed`),
        );
      };
    });
  }

  private onSocketClosed(code: number, reason: string): void {
    this.ready = false;
    this.clearHeartbeat();
    this.rejectAllPending(new Error(`Codex app-server socket closed (${code}) ${reason}`));
    this.logger.warn('codex.app-server.socket_closed', { code, reason });
    this.emit('notification', {
      method: 'error',
      params: { message: 'codex app-server socket closed' },
    } satisfies ServerNotificationMessage);
  }

  private handleMessage(payload: string): void {
    const parsed = JSON.parse(payload) as
      | ServerNotificationMessage
      | ServerRequestMessage
      | JsonRpcFailure;

    if ('id' in parsed && ('result' in parsed || 'error' in parsed)) {
      if (parsed.id === null) return;
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      this.pending.delete(parsed.id);
      if ('error' in parsed) pending.reject(extractJsonRpcError(parsed));
      else pending.resolve(parsed.result);
      return;
    }

    if ('id' in parsed && 'method' in parsed) {
      this.logger.info('codex.request.incoming', {
        method: parsed.method,
        threadId: (parsed as { params?: { threadId?: unknown; conversationId?: unknown } }).params?.threadId,
      });
      this.emit('request', parsed);
      return;
    }

    if ('method' in parsed) {
      this.logger.info('codex.notification.incoming', {
        method: parsed.method,
        threadId: (parsed as { params?: { threadId?: unknown; conversationId?: unknown } }).params?.threadId,
        turnId: (parsed as { params?: { turnId?: unknown } }).params?.turnId,
      });
      this.emit('notification', parsed);
    }
  }

  private isNodeWebSocket(socket: AppServerSocket): socket is NodeWebSocket {
    return typeof (socket as NodeWebSocket).on === 'function';
  }

  private ensureSocket(): AppServerSocket {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error('Codex app-server socket is not ready');
    }
    return this.socket;
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const socket = this.ensureSocket();
    const payload = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
    if (this.isNodeWebSocket(socket)) {
      socket.send(payload);
    } else {
      socket.send(payload);
    }
  }

  private async request<T>(method: string, params: Record<string, unknown> | undefined): Promise<T> {
    const id = ++this.requestId;
    const socket = this.ensureSocket();
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    });

    this.logger.info('codex.request', {
      method,
      threadId: params?.threadId,
      turnId: params?.turnId,
    });

    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.isNodeWebSocket(socket)) {
        socket.send(payload, (error?: Error) => {
          if (!error) return;
          this.pending.delete(id);
          reject(error);
        });
        return;
      }
      try {
        socket.send(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(toError(error));
      }
    });

    this.logger.info('codex.response', {
      method,
      threadId: params?.threadId,
      turnId: params?.turnId,
    });

    return result as T;
  }

  async startThread(args: StartThreadArgs): Promise<{ thread: CodexThread }> {
    const result = await this.request<{ thread: Record<string, unknown> }>(
      'thread/start',
      toThreadStartConfig(this.config, args),
    );
    return { thread: normalizeThread(result.thread) };
  }

  async resumeThread(threadId: string): Promise<{ thread: CodexThread }> {
    const result = await this.request<{ thread: Record<string, unknown> }>('thread/resume', {
      threadId,
    });
    return { thread: normalizeThread(result.thread) };
  }

  async listThreads(): Promise<{ data: CodexThread[] }> {
    const result = await this.request<{ data: Array<Record<string, unknown>> }>('thread/list', {});
    return { data: result.data.map(normalizeThread) };
  }

  async forkThread(threadId: string, cwd?: string | null): Promise<{ thread: CodexThread }> {
    const result = await this.request<{ thread: Record<string, unknown> }>('thread/fork', {
      threadId,
      cwd: cwd || undefined,
      model: this.config.codex.model ?? undefined,
      approvalPolicy: this.config.codex.approval_policy,
      sandbox: this.config.codex.sandbox_mode,
      persistExtendedHistory: true,
    });
    return { thread: normalizeThread(result.thread) };
  }

  async compactThread(threadId: string): Promise<{ ok: boolean }> {
    await this.request('thread/compact/start', { threadId });
    return { ok: true };
  }

  async startTurn(args: StartTurnArgs): Promise<{ turn: CodexTurn }> {
    const result = await this.request<{ turn: Record<string, unknown> }>('turn/start', {
      threadId: args.threadId,
      input: args.input,
      cwd: args.cwd || undefined,
      approvalPolicy: args.approvalPolicy || this.config.codex.approval_policy,
      model: args.model || undefined,
    });
    return { turn: normalizeTurn(result.turn) };
  }

  async steerTurn(args: SteerTurnArgs): Promise<{ turn: CodexTurn }> {
    const result = await this.request<{ turn: Record<string, unknown> }>('turn/steer', args);
    return { turn: normalizeTurn(result.turn) };
  }

  async interruptTurn(args: { threadId: string; turnId: string }): Promise<{ ok: boolean }> {
    await this.request('turn/interrupt', args);
    return { ok: true };
  }

  async listModels(): Promise<{ data: CodexModel[] }> {
    const result = await this.request<{ data: Array<Record<string, unknown>> }>('model/list', {});
    return {
      data: result.data.map(item => ({
        id: String(item.id || item.model || ''),
        model: String(item.model || item.id || ''),
        displayName: String(item.displayName || item.model || item.id || ''),
        isDefault: Boolean(item.isDefault),
      })),
    };
  }

  async startReview(args: { threadId: string; target: ReviewTarget }): Promise<ReviewResult> {
    const result = await this.request<{
      turn: Record<string, unknown>;
      reviewThreadId: string;
    }>('review/start', {
      threadId: args.threadId,
      target: args.target,
      delivery: 'inline',
    });
    return {
      turn: normalizeTurn(result.turn),
      reviewThreadId: result.reviewThreadId,
    };
  }

  async execCommand(args: CommandExecArgs): Promise<CommandExecResult> {
    return this.request<CommandExecResult>('command/exec', args);
  }

  async terminateCommand(processId: string): Promise<{ ok: boolean }> {
    await this.request('command/exec/terminate', { processId });
    return { ok: true };
  }

  async replyApproval(requestId: string | number, payload: Record<string, unknown>): Promise<void> {
    const socket = this.ensureSocket();
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, result: payload }));
  }

  async replyUserInput(
    requestId: string | number,
    payload: { answers: Record<string, { answers: string[] }> },
  ): Promise<void> {
    const socket = this.ensureSocket();
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, result: payload }));
  }

  onNotification(listener: (message: ServerNotificationMessage) => void): void {
    this.on('notification', listener);
  }

  onRequest(listener: (message: ServerRequestMessage) => void): void {
    this.on('request', listener);
  }
}
