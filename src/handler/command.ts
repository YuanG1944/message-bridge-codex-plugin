import path from 'node:path';
import { button, commandCard, markdownCard } from '../feishu/ui/cards.js';
import { clearDetailCache, getDetailCacheStats, pruneDetailCache } from '../feishu/detail-cache.js';
import { HostControlPolicy } from '../host-control/policy.js';
import type {
  BridgeAction,
  BridgeAdapter,
  ChatBinding,
  CodexModel,
  CodexRuntimeClient,
  HostControlProvider,
  LoggerLike,
  PendingServerRequest,
  ReviewTarget,
  SlashCommand,
  WorkspaceProfile,
} from '../types.js';

export type CommandContext = {
  adapter: BridgeAdapter;
  runtime: CodexRuntimeClient;
  logger: LoggerLike;
  chatId: string;
  senderId: string;
  slash: SlashCommand;
  binding: ChatBinding | null;
  ensureThread: () => Promise<ChatBinding>;
  switchWorkspace: (workspaceId: string) => Promise<ChatBinding>;
  updateBinding: (binding: ChatBinding) => void;
  listWorkspaces: () => WorkspaceProfile[];
  findWorkspace: (workspaceId: string) => WorkspaceProfile | undefined;
  actions: BridgeAction[];
  hostProvider: HostControlProvider;
  hostPolicy: HostControlPolicy;
  pendingRequest: PendingServerRequest | null;
};

export function reviewTargetFromArgs(args: string): ReviewTarget {
  const value = String(args || '').trim();
  if (!value || value === 'current') return { type: 'uncommittedChanges' };
  if (/^[0-9a-f]{7,40}$/i.test(value)) return { type: 'commit', sha: value, title: null };
  if (value.startsWith('branch ')) return { type: 'baseBranch', branch: value.slice(7).trim() };
  return { type: 'custom', instructions: value };
}

export function renderThreadList(threads: Array<{ id: string; name: string | null; preview: string }>): string {
  if (threads.length === 0) return 'No threads found.';
  return threads
    .map((thread, index) => `${index + 1}. ${thread.name || thread.preview || thread.id} [${thread.id}]`)
    .join('\n');
}

export function renderThreadsCommand(threads: Array<{ id: string; name: string | null; preview: string }>): string {
  if (threads.length === 0) return '❌ No threads found.';
  return ['### Threads', 'Use `/switch <index|id>` to switch:', renderThreadList(threads)].join('\n');
}

export function renderModels(models: CodexModel[]): string {
  if (models.length === 0) return 'No models found.';
  return models
    .map(
      (model, index) =>
        `${index + 1}. ${model.displayName || model.model} (${model.model})${model.isDefault ? ' [default]' : ''}`,
    )
    .join('\n');
}

export function renderWorkspaces(workspaces: WorkspaceProfile[], currentWorkspaceId: string | null): string {
  if (workspaces.length === 0) return '❌ No workspaces configured.';
  return [
    '### Workspaces',
    'Use `/workspace <id>` to switch:',
    ...workspaces.map((item, index) => {
      const current = item.id === currentWorkspaceId ? ' [current]' : '';
      return `${index + 1}. ${item.name} (${item.id})${current}\ncwd: ${item.cwd}`;
    }),
  ].join('\n');
}

export function renderStatus(binding: ChatBinding | null, pendingRequest: PendingServerRequest | null): string {
  return [
    '### Status',
    `- Thread: ${binding?.thread_id || '-'}`,
    `- Workspace: ${binding?.workspace_id || '-'}`,
    `- Model: ${binding?.model || '-'}`,
    `- Cwd: ${binding?.cwd || '-'}`,
    `- Plan Mode: ${binding?.plan_mode ? 'on' : 'off'}`,
    `- State: ${binding?.state || '-'}`,
    `- Active turn: ${binding?.active_turn_id || '-'}`,
    `- Pending request: ${pendingRequest?.kind || '-'}`,
  ].join('\n');
}

export function renderActions(actions: BridgeAction[]): string {
  if (actions.length === 0) return '### Actions\nNo actions configured.';
  return [
    '### Actions',
    ...actions.map((action, index) => {
      const policy = action.require_approval ? 'approval' : 'auto';
      return `${index + 1}. ${action.name}\ncommand: ${action.command.join(' ')}\npolicy: ${policy}`;
    }),
  ].join('\n');
}

export function renderHostTools(tools: string[]): string {
  if (tools.length === 0) return '### Host Tools\nNo host tools available.';
  return ['### Host Tools', ...tools.map((tool, index) => `${index + 1}. ${tool}`)].join('\n');
}

export function renderHostStatus(status: Awaited<ReturnType<HostControlProvider['getStatus']>>): string {
  return [
    '### Host Status',
    `- hostname: ${status.hostname}`,
    `- user: ${status.user}`,
    `- cwd: ${status.cwd}`,
    `- uptime: ${status.uptime}`,
    `- platform: ${status.platform}`,
  ].join('\n');
}

export function resolveModelSelection(models: CodexModel[], input: string): CodexModel | null {
  const value = String(input || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const target = models[Number(value) - 1];
    return target || null;
  }
  return (
    models.find(model => model.model === value) ||
    models.find(model => model.id === value) ||
    null
  );
}

export function renderApprovalMarkdown(request: PendingServerRequest['request']): string {
  const params = request.params || {};
  const reason = typeof params.reason === 'string' ? params.reason : '';
  const command = typeof params.command === 'string' ? params.command : '';
  const cwd = typeof params.cwd === 'string' ? params.cwd : '';
  const lines = ['## Authorization'];
  if (reason) lines.push(`Reason: ${reason}`);
  if (command) lines.push(`Command: \`${command}\``);
  if (cwd) lines.push(`Cwd: \`${cwd}\``);
  lines.push('', 'Reply with `/approve once`, `/approve session`, `/deny`, or `/cancel`.');
  return lines.join('\n');
}

export function renderUserInputMarkdown(request: PendingServerRequest['request']): string {
  const params = request.params || {};
  const questions = Array.isArray((params as { questions?: unknown[] }).questions)
    ? ((params as { questions: Array<Record<string, unknown>> }).questions || [])
    : [];
  const lines = ['## Input Required'];
  for (const question of questions) {
    lines.push(`### ${String(question.header || question.id || 'Question')}`);
    lines.push(String(question.question || ''));
    const options = Array.isArray(question.options) ? (question.options as Array<Record<string, unknown>>) : [];
    options.forEach((option, index) => {
      lines.push(`${index + 1}. ${String(option.label || '')} - ${String(option.description || '')}`);
    });
  }
  lines.push('', 'Reply in chat with plain text.');
  return lines.join('\n');
}

function parsePlanModeCommand(input: string): 'on' | 'off' | 'status' | null {
  const value = String(input || '').trim().toLowerCase();
  if (!value || value === 'status') return 'status';
  if (['on', 'enable', 'enabled', 'true'].includes(value)) return 'on';
  if (['off', 'disable', 'disabled', 'false'].includes(value)) return 'off';
  return null;
}

function buildQuickReplyActions(request: PendingServerRequest['request']): Array<Record<string, unknown>> {
  const questions = Array.isArray(request.params.questions)
    ? (request.params.questions as Array<Record<string, unknown>>)
    : [];
  if (questions.length !== 1) return [];

  const question = questions[0] || {};
  const questionId = String(question.id || '').trim();
  const options = Array.isArray(question.options) ? (question.options as Array<Record<string, unknown>>) : [];
  if (!questionId || options.length < 2 || options.length > 3) return [];

  const actions: Array<Record<string, unknown>> = [];
  options.forEach((option, index) => {
    const label = String(option.label || '').trim();
    if (!label) return;
    actions.push(
      button(
        label,
        `input:${request.id}:answer:${questionId}:${index}`,
        index === 0 ? 'primary' : 'default',
      ),
    );
  });
  return actions;
}

export async function handleSlashCommand(ctx: CommandContext): Promise<boolean> {
  const { slash, chatId, adapter } = ctx;
  const args = slash.args;

  const sendCommandMessage = async (markdown: string): Promise<void> => {
    if (adapter.sendCard) {
      await adapter.sendCard(chatId, commandCard(markdown));
      return;
    }
    await adapter.sendMessage(chatId, markdown);
  };

  if (slash.command === 'help') {
    await sendCommandMessage(
      [
        '### Help',
        [
          '/help - 查看命令说明和用法',
          '/new - 创建并绑定一个新的 thread',
          '/threads - 列出可恢复的 threads',
          '/switch <index|id> - 切换到指定 thread',
          '/fork - 基于当前 thread 创建分支',
          '/compact - 请求压缩当前 thread 上下文',
          '/interrupt - 中断当前正在运行的 turn',
          '/review [current|<commit>|branch <name>|<instructions>] - 发起代码审查',
          '/model [index|id] - 查看模型列表，或切换到指定模型',
          '/plan [on|off|status] - 切换交互式选项模式偏好',
          '/workspace [id] - 查看或切换工作区',
          '/cwd [path] - 查看或设置当前工作目录',
          '/status - 查看当前 chat 的会话状态',
          '/actions - 查看可执行的预设动作',
          '/run <name> - 执行一个预设动作',
          '/approve once|session - 同意当前授权请求',
          '/deny - 拒绝当前授权请求',
          '/cancel - 取消当前等待中的请求',
          '/sendfile <path> - 把本地文件发到飞书',
          '/savefile - 下一条上传的文件会直接保存到本机',
          '/cache [status|prune|clear] - 管理详情页正文缓存',
          '/host status|tools - 查看主机状态或可用宿主工具',
        ].join('\n'),
      ].join('\n\n'),
    );
    return true;
  }

  if (slash.command === 'new') {
    const binding = await ctx.switchWorkspace(ctx.binding?.workspace_id || ctx.listWorkspaces()[0]?.id || 'default');
    await sendCommandMessage(`Bound new thread ${binding.thread_id}`);
    return true;
  }

  if (slash.command === 'threads') {
    const response = await ctx.runtime.listThreads();
    await sendCommandMessage(renderThreadsCommand(response.data));
    return true;
  }

  if (slash.command === 'switch') {
    const response = await ctx.runtime.listThreads();
    const target = response.data.find(item => item.id === args) || response.data[Number(args) - 1];
    if (!target) {
      await sendCommandMessage(`Thread not found: ${args}`);
      return true;
    }
    const current = await ctx.ensureThread();
    const next = { ...current, thread_id: target.id, thread_name: target.name || target.preview, active_turn_id: null, state: 'idle' as const };
    ctx.updateBinding(next);
    await sendCommandMessage(`Switched to thread ${target.id}`);
    return true;
  }

  if (slash.command === 'fork') {
    const current = await ctx.ensureThread();
    const response = await ctx.runtime.forkThread(current.thread_id, current.cwd || undefined);
    const next = {
      ...current,
      thread_id: response.thread.id,
      thread_name: response.thread.name || response.thread.preview,
      active_turn_id: null,
      state: 'idle' as const,
    };
    ctx.updateBinding(next);
    await sendCommandMessage(`Forked thread ${response.thread.id}`);
    return true;
  }

  if (slash.command === 'compact') {
    const current = await ctx.ensureThread();
    await ctx.runtime.compactThread(current.thread_id);
    await sendCommandMessage('Requested thread compaction.');
    return true;
  }

  if (slash.command === 'interrupt') {
    if (!ctx.binding?.active_turn_id) {
      await sendCommandMessage('No active turn.');
      return true;
    }
    await ctx.runtime.interruptTurn({
      threadId: ctx.binding.thread_id,
      turnId: ctx.binding.active_turn_id,
    });
    await sendCommandMessage('Interrupt requested.');
    return true;
  }

  if (slash.command === 'review') {
    const current = await ctx.ensureThread();
    await ctx.runtime.startReview({
      threadId: current.thread_id,
      target: reviewTargetFromArgs(args),
    });
    await sendCommandMessage('Review started.');
    return true;
  }

  if (slash.command === 'model') {
    const response = await ctx.runtime.listModels();
    if (!args) {
      await sendCommandMessage(`### Models\n${renderModels(response.data)}`);
      return true;
    }
    const target = resolveModelSelection(response.data, args);
    if (!target) {
      await sendCommandMessage(
        [
          `❌ Unknown model: ${args}`,
          'Use `/model` to view available models.',
          'Switch by index like `/model 1` or by exact model id.',
        ].join('\n'),
      );
      return true;
    }
    const current = await ctx.ensureThread();
    const next = { ...current, model: target.model };
    ctx.updateBinding(next);
    await sendCommandMessage(`✅ Model set to ${target.displayName || target.model} (${target.model})`);
    return true;
  }

  if (slash.command === 'plan') {
    const mode = parsePlanModeCommand(args);
    if (!mode) {
      await sendCommandMessage('Usage: /plan on|off|status');
      return true;
    }
    if (mode === 'status') {
      await sendCommandMessage(`Plan mode is ${ctx.binding?.plan_mode ? 'on' : 'off'}.`);
      return true;
    }
    const current = await ctx.ensureThread();
    const enabled = mode === 'on';
    ctx.updateBinding({ ...current, plan_mode: enabled });
    await sendCommandMessage(
      enabled
        ? 'Plan mode enabled. Choice questions will prefer card buttons when possible.'
        : 'Plan mode disabled. Input requests will stay in plain chat reply mode.',
    );
    return true;
  }

  if (slash.command === 'workspace') {
    if (!args) {
      await sendCommandMessage(renderWorkspaces(ctx.listWorkspaces(), ctx.binding?.workspace_id || null));
      return true;
    }
    const next = await ctx.switchWorkspace(args);
    await sendCommandMessage(`Workspace set to ${next.workspace_id}`);
    return true;
  }

  if (slash.command === 'cwd') {
    if (!args) {
      await sendCommandMessage(ctx.binding?.cwd || ctx.listWorkspaces()[0]?.cwd || process.cwd());
      return true;
    }
    const current = await ctx.ensureThread();
    const next = { ...current, cwd: path.resolve(args) };
    ctx.updateBinding(next);
    await sendCommandMessage(`Working directory set to ${next.cwd}`);
    return true;
  }

  if (slash.command === 'actions') {
    await sendCommandMessage(renderActions(ctx.actions));
    return true;
  }

  if (slash.command === 'run') {
    const action = ctx.actions.find(item => item.name === args);
    if (!action) {
      await sendCommandMessage(`Unknown action: ${args}`);
      return true;
    }
    const result = await ctx.runtime.execCommand({
      command: action.command,
      cwd: action.cwd,
      processId: `action-${Date.now()}`,
      streamStdoutStderr: false,
      timeoutMs: 120_000,
    });
    await sendCommandMessage(`$ ${action.command.join(' ')}\n\n${result.stdout || result.stderr}\n\nexit=${result.exitCode}`);
    return true;
  }

  if (slash.command === 'sendfile') {
    if (!args) {
      await sendCommandMessage('Usage: /sendfile <path>');
      return true;
    }
    await adapter.sendLocalFile(chatId, args);
    await sendCommandMessage(`Sent file ${args}`);
    return true;
  }

  if (slash.command === 'savefile') {
    const current = await ctx.ensureThread();
    ctx.updateBinding({ ...current, save_file_next: true });
    await sendCommandMessage('Upload a file in your next message and it will be stored locally.');
    return true;
  }

  if (slash.command === 'status') {
    await sendCommandMessage(renderStatus(ctx.binding, ctx.pendingRequest));
    return true;
  }

  if (slash.command === 'host') {
    const sub = args.trim().toLowerCase();
    if (sub === 'tools') {
      await sendCommandMessage(renderHostTools(ctx.hostPolicy.visibleTools()));
      return true;
    }
    if (sub === 'status') {
      const status = await ctx.hostProvider.getStatus();
      await sendCommandMessage(renderHostStatus(status));
      return true;
    }
  }

  if (slash.command === 'cache') {
    const sub = args.trim().toLowerCase() || 'status';
    if (sub === 'status') {
      const stats = getDetailCacheStats();
      await sendCommandMessage(
        [
          '### Cache',
          `- entries: ${stats.entries}`,
          `- ttl_ms: ${stats.ttlMs}`,
          `- max_entries: ${stats.maxEntries}`,
        ].join('\n'),
      );
      return true;
    }
    if (sub === 'prune') {
      const removed = pruneDetailCache();
      const stats = getDetailCacheStats();
      await sendCommandMessage(
        `Pruned ${removed} detail cache entries. Remaining: ${stats.entries}`,
      );
      return true;
    }
    if (sub === 'clear') {
      const removed = clearDetailCache();
      await sendCommandMessage(`Cleared ${removed} detail cache entries.`);
      return true;
    }
    await sendCommandMessage('Usage: /cache [status|prune|clear]');
    return true;
  }

  if (slash.command === 'approve' || slash.command === 'deny' || slash.command === 'cancel') {
    if (!ctx.pendingRequest) {
      await sendCommandMessage('No pending approval or input.');
      return true;
    }

    const requestId = String(ctx.pendingRequest.request.id);
    if (ctx.pendingRequest.kind === 'item/tool/requestUserInput') {
      const answer = slash.command === 'cancel' ? '' : args || slash.command;
      const questions = Array.isArray(ctx.pendingRequest.request.params.questions)
        ? (ctx.pendingRequest.request.params.questions as Array<Record<string, unknown>>)
        : [];
      const answers = Object.fromEntries(
        questions.map(question => [String(question.id), { answers: [answer] }]),
      );
      await ctx.runtime.replyUserInput(requestId, { answers });
    } else if (ctx.pendingRequest.kind === 'item/permissions/requestApproval') {
      const params = ctx.pendingRequest.request.params as Record<string, unknown>;
      await ctx.runtime.replyApproval(requestId, {
        permissions:
          slash.command === 'deny' || slash.command === 'cancel' ? {} : params.permissions || {},
        scope: args === 'session' ? 'session' : 'turn',
      });
    } else {
      await ctx.runtime.replyApproval(requestId, {
        decision:
          slash.command === 'deny'
            ? 'decline'
            : slash.command === 'cancel'
              ? 'cancel'
              : args === 'session'
                ? 'acceptForSession'
                : 'accept',
      });
    }

    await sendCommandMessage(`Resolved pending request ${ctx.pendingRequest.kind}.`);
    return true;
  }

  return false;
}

export function buildApprovalCard(request: PendingServerRequest['request']) {
  return markdownCard(renderApprovalMarkdown(request), [
    button('Allow Once', `approval:${request.id}:accept`, 'primary'),
    button('Allow Session', `approval:${request.id}:acceptForSession`, 'default'),
    button('Deny', `approval:${request.id}:decline`, 'danger'),
    button('Cancel', `approval:${request.id}:cancel`, 'default'),
  ]);
}

export function buildUserInputCard(
  request: PendingServerRequest['request'],
  options: { enableQuickActions?: boolean } = {},
) {
  const actions = options.enableQuickActions ? buildQuickReplyActions(request) : [];
  actions.push(button('Reply In Chat', `input:${request.id}:reply`, actions.length ? 'default' : 'primary'));
  return markdownCard(renderUserInputMarkdown(request), actions);
}
