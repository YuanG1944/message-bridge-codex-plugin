import type { Server } from 'node:http';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { WriteStream } from 'node:fs';
import type { Database, Statement } from 'bun:sqlite';
import type WebSocket from 'ws';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LoggerLike = {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
};

export type LoggerOptions = {
  level?: LogLevel;
  stdout?: boolean;
  filePath?: string;
};

export type FeishuMode = 'ws' | 'webhook';
export type CodexRuntimeMode = 'app-server' | 'sdk';
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type FeishuConfig = {
  app_id: string;
  app_secret: string;
  mode: FeishuMode;
  port: number;
  callback_url: string;
  encrypt_key: string;
  verification_token: string;
  signing_secret: string;
};

export type WorkspaceProfile = {
  id: string;
  name: string;
  cwd: string;
  additional_directories: string[];
  default_model: string | null;
  web_search: boolean;
};

export type CodexConfig = {
  runtime: CodexRuntimeMode;
  binary_path: string;
  model: string | null;
  cwd: string;
  sandbox_mode: SandboxMode;
  approval_policy: ApprovalPolicy;
  workspace_roots: string[];
  allow_free_cwd: boolean;
  network_access: boolean;
  web_search: boolean;
};

export type SecurityConfig = {
  allowed_sender_ids: string[];
  enable_trusted_senders: boolean;
  enable_host_danger_tools: boolean;
};

export type HostControlConfig = {
  enabled: boolean;
  provider: 'linux' | 'macos' | 'auto';
  allowed_tools: string[];
  danger_tools: string[];
};

export type BridgeAction = {
  name: string;
  command: string[];
  cwd: string;
  require_approval: boolean;
  allow_network: boolean;
};

export type StorageConfig = {
  database_path: string;
  files_dir: string;
  log_file: string;
};

export type BridgeConfig = {
  configPath: string;
  baseDir: string;
  feishu: FeishuConfig;
  codex: CodexConfig;
  security: SecurityConfig;
  workspaces: WorkspaceProfile[];
  host_control: HostControlConfig;
  actions: BridgeAction[];
  storage: StorageConfig;
};

export type SlashCommand = {
  command: string;
  args: string;
};

export type IncomingAttachment = {
  localPath: string;
  filename?: string;
  mimeType?: string;
  kind: 'image' | 'file';
};

export type IncomingMessageEnvelope = {
  type: 'message';
  chatId: string;
  senderId: string;
  messageId: string;
  text: string;
  chatType: 'p2p' | 'group' | 'unknown';
  attachments?: IncomingAttachment[];
};

export type IncomingActionEnvelope = {
  type: 'action';
  action: string;
  chatId: string;
  senderId: string;
  messageId: string;
  chatType: 'p2p' | 'group' | 'unknown';
};

export type IncomingEnvelope = IncomingMessageEnvelope | IncomingActionEnvelope;

export type ThreadBindingState =
  | 'idle'
  | 'turn_running'
  | 'awaiting_approval'
  | 'awaiting_user_input';

export type ChatBinding = {
  chat_id: string;
  sender_id: string;
  chat_type: 'p2p' | 'group' | 'unknown';
  thread_id: string;
  thread_name: string | null;
  workspace_id: string | null;
  model: string | null;
  cwd: string | null;
  plan_mode: boolean;
  active_turn_id: string | null;
  state: ThreadBindingState;
  save_file_next: boolean;
  created_at?: string;
  updated_at?: string;
};

export type PendingRequestKind =
  | 'item/tool/requestUserInput'
  | 'item/permissions/requestApproval'
  | 'item/commandExecution/requestApproval'
  | 'item/fileChange/requestApproval'
  | 'mcpServer/elicitation/request'
  | 'execCommandApproval'
  | 'applyPatchApproval';

export type PendingServerRequest = {
  request_id: string;
  chat_id: string;
  kind: PendingRequestKind;
  request_json: string;
  created_at: string;
  request: ServerRequestMessage;
};

export type AuditLogEntry = {
  id: number;
  chat_id: string | null;
  sender_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
  payload: unknown;
};

export type FeishuApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: string | FormData;
  contentType?: string;
};

export type FeishuAdapterCtor = {
  config: FeishuConfig;
  logger: LoggerLike;
  filesDir: string;
  allowedFileRoots?: string[];
};

export type FeishuCard = {
  config?: {
    wide_screen_mode?: boolean;
    update_multi?: boolean;
    summary?: { content: string };
  };
  header?: {
    title: { tag: 'plain_text'; content: string };
    template?: string;
  };
  elements: Array<Record<string, unknown>>;
};

export type FeishuCardKit = {
  schema: '2.0';
  config?: Record<string, unknown>;
  header?: Record<string, unknown>;
  body: {
    elements: Array<Record<string, unknown>>;
  };
};

export type TurnBufferTarget =
  | 'reasoning'
  | 'answer'
  | 'commandOutput'
  | 'fileChanges'
  | 'toolActivity'
  | 'statusText'
  | 'approval'
  | 'userInput';

export type ExecProcessState = {
  chatId: string;
  buffer: string;
};

export type HostControlPolicyConfig = {
  allowed_tools?: string[];
  danger_tools?: string[];
  enableDangerTools?: boolean;
};

export type LoggerFields = {
  level: LogLevel;
  stdout: boolean;
  filePath: string;
  stream: WriteStream | null;
};

export type FeishuAdapterFields = {
  config: FeishuConfig;
  logger: LoggerLike;
  filesDir: string;
  httpServer: Server | null;
  wsClient: { start: (args: unknown) => Promise<void> } | null;
  tenantToken: string | null;
  tenantTokenExpiresAt: number;
};

export type SqliteStatements = {
  getBinding: Statement;
  upsertBinding: Statement;
  setPendingRequest: Statement;
  getPendingByChat: Statement;
  deletePending: Statement;
  insertAttachment: Statement;
  insertAllowedSender: Statement;
  getAllowedSender: Statement;
  insertAudit: Statement;
  listAudit: Statement;
  findByThread: Statement;
  listRunningBindings: Statement;
};

export type SqliteStoreFields = {
  db: Database;
  statements: SqliteStatements;
};

export type RuntimeConfigForHostControl = {
  allowed_tools?: string[];
  danger_tools?: string[];
  enable_danger_tools?: boolean;
};

export type BridgeAdapter = {
  start(onEnvelope: (envelope: IncomingEnvelope) => Promise<void>): Promise<void>;
  stop?(): Promise<void>;
  sendMessage(
    chatId: string,
    markdown: string,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null>;
  editMessage(chatId: string, messageId: string, markdown: string): Promise<boolean>;
  addReaction?(messageId: string, emojiType: string): Promise<string | null>;
  removeReaction?(messageId: string, reactionId: string): Promise<boolean>;
  sendLocalFile(chatId: string, localPath: string): Promise<boolean>;
  sendCard?(
    chatId: string,
    card: FeishuCard | FeishuCardKit,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null>;
};

export type HostStatus = {
  hostname: string;
  user: string;
  cwd: string;
  uptime: string;
  platform: string;
};

export type HostWindow = {
  id: string;
  desktop?: string;
  host?: string;
  klass?: string;
  title?: string;
};

export type HostControlProvider = {
  getStatus(): Promise<HostStatus>;
  openUrl(args: { url: string }): Promise<{ opened: string }>;
  openApp(args: { command: string; args?: string[] }): Promise<{ launched: string; args: string[] }>;
  captureScreen(): Promise<{ path: string }>;
  listWindows(): Promise<{ windows: HostWindow[] }>;
  focusWindow(args: { windowId: string }): Promise<{ focused: string }>;
  readClipboard(): Promise<{ text: string }>;
  writeClipboard(args: { text: string }): Promise<{ written: boolean }>;
  notify(args: { title: string; body?: string }): Promise<{ notified: boolean; reason?: string }>;
};

export type CodexUserInput =
  | { type: 'text'; text: string; text_elements: Array<Record<string, unknown>> }
  | { type: 'localImage'; path: string };

export type CodexThread = {
  id: string;
  preview: string;
  name: string | null;
  cwd: string;
  status?: string;
};

export type CodexTurn = {
  id: string;
  status: string;
  items?: unknown[];
  error?: { message?: string } | null;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
};

export type StartThreadArgs = {
  cwd: string;
  model?: string | null;
  workspaceId?: string | null;
};

export type StartTurnArgs = {
  threadId: string;
  input: CodexUserInput[];
  cwd?: string | null;
  model?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
};

export type SteerTurnArgs = {
  threadId: string;
  expectedTurnId: string;
  input: CodexUserInput[];
};

export type CommandExecArgs = {
  command: string[];
  cwd?: string | null;
  processId?: string | null;
  tty?: boolean;
  streamStdoutStderr?: boolean;
  streamStdin?: boolean;
  timeoutMs?: number | null;
};

export type CommandExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string | null }
  | { type: 'custom'; instructions: string };

export type ReviewResult = {
  turn: CodexTurn;
  reviewThreadId: string;
};

export type ServerRequestMessage = {
  jsonrpc?: '2.0';
  id: string | number;
  method: PendingRequestKind;
  params: Record<string, unknown>;
};

export type ServerNotificationMessage = {
  jsonrpc?: '2.0';
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcSuccess = {
  jsonrpc?: '2.0';
  id: string | number;
  result: unknown;
};

export type JsonRpcFailure = {
  jsonrpc?: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
};

export type CodexRuntimeClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  startThread(args: StartThreadArgs): Promise<{ thread: CodexThread }>;
  resumeThread(threadId: string): Promise<{ thread: CodexThread }>;
  listThreads(): Promise<{ data: CodexThread[] }>;
  forkThread(threadId: string, cwd?: string | null): Promise<{ thread: CodexThread }>;
  compactThread(threadId: string): Promise<{ ok: boolean }>;
  startTurn(args: StartTurnArgs): Promise<{ turn: CodexTurn }>;
  steerTurn(args: SteerTurnArgs): Promise<{ turn: CodexTurn }>;
  interruptTurn(args: { threadId: string; turnId: string }): Promise<{ ok: boolean }>;
  listModels(): Promise<{ data: CodexModel[] }>;
  startReview(args: { threadId: string; target: ReviewTarget }): Promise<ReviewResult>;
  execCommand(args: CommandExecArgs): Promise<CommandExecResult>;
  terminateCommand(processId: string): Promise<{ ok: boolean }>;
  replyApproval(requestId: string | number, payload: Record<string, unknown>): Promise<void>;
  replyUserInput(
    requestId: string | number,
    payload: { answers: Record<string, { answers: string[] }> },
  ): Promise<void>;
  onNotification(listener: (message: ServerNotificationMessage) => void): void;
  onRequest(listener: (message: ServerRequestMessage) => void): void;
};

export type AppServerClientFields = {
  child: ChildProcessWithoutNullStreams | null;
  socket: WebSocket | null;
  requestId: number;
  ready: boolean;
};
