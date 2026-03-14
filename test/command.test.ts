import { describe, expect, test } from 'bun:test';
import {
  buildUserInputCard,
  handleSlashCommand,
  renderActions,
  renderHostStatus,
  renderHostTools,
  renderModels,
  renderStatus,
  renderThreadsCommand,
  renderWorkspaces,
  resolveModelSelection,
  type CommandContext,
} from '../src/handler/command.js';
import { commandCard } from '../src/feishu/ui/cards.js';
import type {
  BridgeAdapter,
  ChatBinding,
  CodexModel,
  CodexRuntimeClient,
  HostControlProvider,
  LoggerLike,
  PendingServerRequest,
  SlashCommand,
  WorkspaceProfile,
} from '../src/types.js';
import { HostControlPolicy } from '../src/host-control/policy.js';

function createContext(args: {
  slash: SlashCommand;
  models?: CodexModel[];
  binding?: ChatBinding | null;
}): CommandContext & { sent: string[]; bindingRef: { current: ChatBinding | null } } {
  const sent: string[] = [];
  const bindingRef = {
    current:
      args.binding ||
      ({
        chat_id: 'chat-1',
        sender_id: 'user-1',
        chat_type: 'p2p',
        thread_id: 'thread-1',
        thread_name: 'Thread 1',
        workspace_id: 'default',
        model: null,
        cwd: '/tmp/demo',
        plan_mode: false,
        active_turn_id: null,
        state: 'idle',
        save_file_next: false,
        updated_at: new Date().toISOString(),
      } satisfies ChatBinding),
  };
  const models =
    args.models ||
    [
      { id: 'gpt-5', model: 'gpt-5', displayName: 'GPT-5', isDefault: true },
      { id: 'gpt-5-codex', model: 'gpt-5-codex', displayName: 'GPT-5 Codex', isDefault: false },
    ];

  const adapter: BridgeAdapter = {
    async start() {},
    async sendMessage(_chatId, text) {
      sent.push(text);
      return `msg-${sent.length}`;
    },
    async sendCard(_chatId, card) {
      sent.push(typeof card === 'string' ? card : JSON.stringify(card));
      return `msg-${sent.length}`;
    },
    async editMessage() {
      return true;
    },
    async sendLocalFile() {
      return true;
    },
  };

  const runtime = {
    async listModels() {
      return { data: models };
    },
  } as unknown as CodexRuntimeClient;

  const logger: LoggerLike = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  const hostProvider = {
    async getStatus() {
      return { hostname: 'host', user: 'user', cwd: '/tmp/demo', uptime: '1h', platform: 'linux' };
    },
  } as unknown as HostControlProvider;

  return {
    adapter,
    runtime,
    logger,
    chatId: 'chat-1',
    senderId: 'user-1',
    slash: args.slash,
    binding: bindingRef.current,
    async ensureThread() {
      return bindingRef.current as ChatBinding;
    },
    async switchWorkspace() {
      return bindingRef.current as ChatBinding;
    },
    updateBinding(binding) {
      bindingRef.current = binding;
    },
    listWorkspaces() {
      return [] as WorkspaceProfile[];
    },
    findWorkspace() {
      return undefined;
    },
    actions: [],
    hostProvider,
    hostPolicy: new HostControlPolicy({ allowed_tools: ['host.get_status'] }),
    pendingRequest: null as PendingServerRequest | null,
    sent,
    bindingRef,
  };
}

describe('model slash command', () => {
  test('renders indexed model list', () => {
    const markdown = renderModels([
      { id: 'gpt-5', model: 'gpt-5', displayName: 'GPT-5', isDefault: true },
      { id: 'gpt-5-codex', model: 'gpt-5-codex', displayName: 'GPT-5 Codex', isDefault: false },
    ]);

    expect(markdown).toContain('1. GPT-5 (gpt-5) [default]');
    expect(markdown).toContain('2. GPT-5 Codex (gpt-5-codex)');
  });

  test('supports switching model by index', async () => {
    const ctx = createContext({
      slash: { command: 'model', args: '2' },
    });

    const handled = await handleSlashCommand(ctx);

    expect(handled).toBe(true);
    expect(ctx.bindingRef.current?.model).toBe('gpt-5-codex');
    expect(ctx.sent.join('\n')).toContain('✅ Model set to GPT-5 Codex (gpt-5-codex)');
  });

  test('rejects unknown model id without mutating binding', async () => {
    const ctx = createContext({
      slash: { command: 'model', args: 'missing-model' },
      binding: {
        chat_id: 'chat-1',
        sender_id: 'user-1',
        chat_type: 'p2p',
        thread_id: 'thread-1',
        thread_name: 'Thread 1',
        workspace_id: 'default',
        model: 'gpt-5',
        cwd: '/tmp/demo',
        plan_mode: false,
        active_turn_id: null,
        state: 'idle',
        save_file_next: false,
        updated_at: new Date().toISOString(),
      },
    });

    const handled = await handleSlashCommand(ctx);

    expect(handled).toBe(true);
    expect(ctx.bindingRef.current?.model).toBe('gpt-5');
    expect(ctx.sent.join('\n')).toContain('❌ Unknown model: missing-model');
  });

  test('resolves model by exact id or list index', () => {
    const models = [
      { id: 'gpt-5', model: 'gpt-5', displayName: 'GPT-5', isDefault: true },
      { id: 'gpt-5-codex', model: 'gpt-5-codex', displayName: 'GPT-5 Codex', isDefault: false },
    ];

    expect(resolveModelSelection(models, '1')?.model).toBe('gpt-5');
    expect(resolveModelSelection(models, 'gpt-5-codex')?.model).toBe('gpt-5-codex');
    expect(resolveModelSelection(models, 'missing')).toBeNull();
  });

  test('renders help command with descriptions in a command card', async () => {
    const ctx = createContext({
      slash: { command: 'help', args: '' },
    });

    const handled = await handleSlashCommand(ctx);
    const payload = JSON.parse(ctx.sent[0] || '{}') as Record<string, unknown>;
    const body = payload.body as { elements?: unknown[] } | undefined;

    expect(handled).toBe(true);
    expect(JSON.stringify(payload.header || {})).toContain('🧭 Command');
    expect(JSON.stringify(body?.elements || [])).toContain('/model [index|id]');
    expect(JSON.stringify(body?.elements || [])).toContain('/plan [on|off|status]');
    expect(JSON.stringify(body?.elements || [])).toContain('/help');
  });

  test('supports toggling plan mode by slash command', async () => {
    const ctx = createContext({
      slash: { command: 'plan', args: 'on' },
    });

    const handled = await handleSlashCommand(ctx);

    expect(handled).toBe(true);
    expect(ctx.bindingRef.current?.plan_mode).toBe(true);
    expect(ctx.sent.join('\n')).toContain('Plan mode enabled');
  });

  test('renders error command cards with error header', () => {
    const payload = commandCard('❌ Unknown model: missing-model') as unknown as Record<string, unknown>;
    const body = payload.body as { elements?: unknown[] } | undefined;

    expect(JSON.stringify(payload.header || {})).toContain('❌ Error');
    expect(JSON.stringify(payload.header || {})).toContain('red');
    expect(JSON.stringify(body?.elements || [])).toContain('❌ Unknown model: missing-model');
  });

  test('renders threads and workspaces as structured command sections', () => {
    const threadsCard = commandCard(
      renderThreadsCommand([{ id: 'thread-1', name: 'Main Thread', preview: 'Main Thread' }]),
    ) as unknown as Record<string, unknown>;
    const workspacesCard = commandCard(
      renderWorkspaces(
        [
          {
            id: 'default',
            name: 'Default Workspace',
            cwd: '/tmp/demo',
            additional_directories: [],
            default_model: null,
            web_search: false,
          },
        ],
        'default',
      ),
    ) as unknown as Record<string, unknown>;
    const threadsBody = threadsCard.body as { elements?: unknown[] } | undefined;
    const workspacesBody = workspacesCard.body as { elements?: unknown[] } | undefined;

    expect(JSON.stringify(threadsBody?.elements || [])).toContain('**Threads**');
    expect(JSON.stringify(threadsBody?.elements || [])).toContain('/switch <index|id>');
    expect(JSON.stringify(workspacesBody?.elements || [])).toContain('**Workspaces**');
    expect(JSON.stringify(workspacesBody?.elements || [])).toContain('Default Workspace');
  });

  test('renders status, actions, and host sections with command formatting', () => {
    const statusCard = commandCard(
      renderStatus(
        {
          chat_id: 'chat-1',
          sender_id: 'user-1',
          chat_type: 'p2p',
          thread_id: 'thread-1',
          thread_name: 'Thread 1',
          workspace_id: 'default',
          model: 'gpt-5',
          cwd: '/tmp/demo',
          plan_mode: false,
          active_turn_id: null,
          state: 'idle',
          save_file_next: false,
          updated_at: new Date().toISOString(),
        },
        null,
      ),
    ) as unknown as Record<string, unknown>;
    const actionsCard = commandCard(
      renderActions([
        {
          name: 'build',
          command: ['bun', 'run', 'build'],
          require_approval: false,
          cwd: '/tmp/demo',
          allow_network: false,
        },
      ]),
    ) as unknown as Record<string, unknown>;
    const hostCard = commandCard(
      [renderHostTools(['host.get_status']), renderHostStatus({
        hostname: 'host',
        user: 'user',
        cwd: '/tmp/demo',
        uptime: '1h',
        platform: 'linux',
      })].join('\n\n'),
    ) as unknown as Record<string, unknown>;
    const statusBody = statusCard.body as { elements?: unknown[] } | undefined;
    const actionsBody = actionsCard.body as { elements?: unknown[] } | undefined;
    const hostBody = hostCard.body as { elements?: unknown[] } | undefined;

    expect(JSON.stringify(statusBody?.elements || [])).toContain('**Status**');
    expect(JSON.stringify(statusBody?.elements || [])).toContain('gpt-5');
    expect(JSON.stringify(actionsBody?.elements || [])).toContain('**Actions**');
    expect(JSON.stringify(actionsBody?.elements || [])).toContain('bun run build');
    expect(JSON.stringify(hostBody?.elements || [])).toContain('**Host Tools**');
    expect(JSON.stringify(hostBody?.elements || [])).toContain('host.get_status');
  });

  test('renders quick choice buttons for requestUserInput in plan mode', () => {
    const payload = buildUserInputCard(
      {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'item/tool/requestUserInput',
        params: {
          questions: [
            {
              id: 'choice',
              header: 'Sandbox',
              question: 'Pick one mode',
              options: [
                { label: 'Workspace Write', description: 'Recommended' },
                { label: 'Read Only', description: 'Safer' },
              ],
            },
          ],
        },
      },
      { enableQuickActions: true },
    ) as unknown as Record<string, unknown>;

    const elements = payload.elements as unknown[] | undefined;
    expect(JSON.stringify(elements || [])).toContain('Pick one mode');
    expect(JSON.stringify(elements || [])).toContain('Workspace Write');
    expect(JSON.stringify(elements || [])).toContain('input:req-1:answer:choice:0');
    expect(JSON.stringify(elements || [])).toContain('Reply In Chat');
  });
});
