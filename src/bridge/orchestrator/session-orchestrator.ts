import crypto from 'node:crypto';
import path from 'node:path';
import { MessageBuffer } from './message-buffer.js';
import { applyNotificationToBuffer, buildApprovalCard, buildUserInputCard, handleSlashCommand, toCodexInputs } from '../../handler/index.js';
import type {
  BridgeConfig,
  BridgeAdapter,
  ChatBinding,
  CodexRuntimeClient,
  ExecProcessState,
  IncomingActionEnvelope,
  IncomingEnvelope,
  IncomingMessageEnvelope,
  LoggerLike,
  PendingServerRequest,
  ServerNotificationMessage,
  ServerRequestMessage,
} from '../../types.js';
import { SqliteStore } from '../../store/sqlite-store.js';
import { HostControlPolicy } from '../../host-control/policy.js';
import { createHostControlProvider } from '../../host-control/index.js';
import { isAllowedCwd, parseSlashCommand } from '../../utils.js';

export class SessionOrchestrator {
  private readonly config: BridgeConfig;
  private readonly logger: LoggerLike;
  private readonly store: SqliteStore;
  private readonly adapter: BridgeAdapter;
  private readonly runtime: CodexRuntimeClient;
  private readonly turnBuffers = new Map<string, MessageBuffer>();
  private readonly execProcesses = new Map<string, ExecProcessState>();
  private readonly hydratedThreadIds = new Set<string>();
  private readonly turnTypingStates = new Map<string, { messageId: string; reactionId: string | null }>();
  private readonly hostProvider;
  private readonly hostPolicy: HostControlPolicy;

  constructor(input: {
    config: BridgeConfig;
    logger: LoggerLike;
    store: SqliteStore;
    adapter: BridgeAdapter;
    runtime: CodexRuntimeClient;
  }) {
    this.config = input.config;
    this.logger = input.logger;
    this.store = input.store;
    this.adapter = input.adapter;
    this.runtime = input.runtime;
    this.hostProvider = createHostControlProvider(this.config.host_control);
    this.hostPolicy = new HostControlPolicy({
      allowed_tools: this.config.host_control.allowed_tools,
      danger_tools: this.config.host_control.danger_tools,
      enableDangerTools: this.config.security.enable_host_danger_tools,
    });
  }

  async start(): Promise<void> {
    this.runtime.onNotification(message => {
      void this.handleNotification(message);
    });
    this.runtime.onRequest(message => {
      void this.handleServerRequest(message);
    });
  }

  private isSenderAllowed(senderId: string): boolean {
    const configured = this.config.security.allowed_sender_ids;
    if (!configured.length) return true;
    return configured.includes(senderId) || this.store.isAllowedSender(senderId);
  }

  private getDefaultWorkspace() {
    return this.config.workspaces[0] || {
      id: 'default',
      name: 'Default Workspace',
      cwd: this.config.codex.cwd,
      additional_directories: this.config.codex.workspace_roots,
      default_model: this.config.codex.model,
      web_search: this.config.codex.web_search,
    };
  }

  private findWorkspace(workspaceId: string | null | undefined) {
    return this.config.workspaces.find(item => item.id === workspaceId);
  }

  private saveBinding(binding: ChatBinding): void {
    this.store.saveBinding(binding);
  }

  private isThreadNotFoundError(error: unknown): boolean {
    return String((error as { message?: unknown })?.message || error)
      .toLowerCase()
      .includes('thread not found');
  }

  private async addTypingIndicator(messageId: string): Promise<{ messageId: string; reactionId: string | null } | null> {
    if (!this.adapter.addReaction) return null;
    const reactionId = await this.adapter.addReaction(messageId, 'Typing');
    return { messageId, reactionId };
  }

  private async clearTypingIndicator(turnId: string | null | undefined): Promise<void> {
    if (!turnId || !this.adapter.removeReaction) return;
    const state = this.turnTypingStates.get(turnId);
    if (!state?.reactionId) {
      this.turnTypingStates.delete(turnId);
      return;
    }
    await this.adapter.removeReaction(state.messageId, state.reactionId);
    this.turnTypingStates.delete(turnId);
  }

  private async clearDirectTypingIndicator(
    state: { messageId: string; reactionId: string | null } | null,
  ): Promise<void> {
    if (!state?.reactionId || !this.adapter.removeReaction) return;
    await this.adapter.removeReaction(state.messageId, state.reactionId);
  }

  async handleEnvelope(envelope: IncomingEnvelope): Promise<void> {
    this.logger.info('bridge.incoming', envelope);

    if (!this.isSenderAllowed(envelope.senderId)) {
      await this.adapter.sendMessage(envelope.chatId, '## Answer\nThis sender is not allowed to control this host.');
      return;
    }

    if (envelope.type === 'action') {
      await this.handleActionEnvelope(envelope);
      return;
    }

    const binding = this.store.getBinding(envelope.chatId);
    const slash = parseSlashCommand(envelope.text);
    if (slash) {
      const handled = await handleSlashCommand({
        adapter: this.adapter,
        runtime: this.runtime,
        logger: this.logger,
        chatId: envelope.chatId,
        senderId: envelope.senderId,
        slash,
        binding,
        ensureThread: async () => this.ensureThread(envelope, binding),
        switchWorkspace: async workspaceId => this.createNewThreadBinding(envelope, workspaceId),
        updateBinding: next => this.saveBinding(next),
        listWorkspaces: () => this.config.workspaces,
        findWorkspace: workspaceId => this.findWorkspace(workspaceId),
        actions: this.config.actions,
        hostProvider: this.hostProvider,
        hostPolicy: this.hostPolicy,
        pendingRequest: this.store.getPendingRequest(envelope.chatId),
      });
      if (handled) return;
    }

    const pending = this.store.getPendingRequest(envelope.chatId);
    if (pending) {
      await this.replyToPending(envelope, pending);
      return;
    }

    if (binding?.save_file_next && envelope.attachments?.length) {
      this.saveBinding({ ...binding, save_file_next: false });
      envelope.attachments.forEach(item => {
        this.store.saveAttachment({
          chatId: envelope.chatId,
          messageId: envelope.messageId,
          filePath: item.localPath,
          mimeType: item.mimeType,
          isImage: item.kind === 'image',
        });
      });
      await this.adapter.sendMessage(
        envelope.chatId,
        `## Answer\nSaved ${envelope.attachments.length} file(s):\n${envelope.attachments
          .map(item => item.localPath)
          .join('\n')}`,
      );
      return;
    }

    await this.routeTurn(envelope, binding);
  }

  private async createNewThreadBinding(
    envelope: IncomingMessageEnvelope,
    workspaceId: string,
  ): Promise<ChatBinding> {
    const workspace = this.findWorkspace(workspaceId) || this.getDefaultWorkspace();
    const response = await this.runtime.startThread({
      cwd: workspace.cwd,
      model: workspace.default_model,
      workspaceId: workspace.id,
    });
    const next: ChatBinding = {
      chat_id: envelope.chatId,
      sender_id: envelope.senderId,
      chat_type: envelope.chatType,
      thread_id: response.thread.id,
      thread_name: response.thread.name || response.thread.preview,
      workspace_id: workspace.id,
      model: workspace.default_model,
      cwd: workspace.cwd,
      plan_mode: false,
      active_turn_id: null,
      state: 'idle',
      save_file_next: false,
    };
    this.saveBinding(next);
    this.hydratedThreadIds.add(next.thread_id);
    this.store.audit({
      chatId: envelope.chatId,
      senderId: envelope.senderId,
      eventType: 'thread.created',
      payload: response.thread,
    });
    return next;
  }

  private async ensureThread(
    envelope: IncomingMessageEnvelope,
    binding: ChatBinding | null,
  ): Promise<ChatBinding> {
    if (binding?.thread_id) {
      if (this.hydratedThreadIds.has(binding.thread_id)) return binding;
      try {
        const resumed = await this.runtime.resumeThread(binding.thread_id);
        const next = {
          ...binding,
          thread_name: resumed.thread.name || resumed.thread.preview || binding.thread_name,
          cwd: binding.cwd || resumed.thread.cwd,
          active_turn_id: null,
          state: 'idle' as const,
        };
        this.saveBinding(next);
        this.hydratedThreadIds.add(next.thread_id);
        return next;
      } catch (error) {
        if (!this.isThreadNotFoundError(error)) throw error;
        this.logger.warn('bridge.thread_missing_recreate', {
          chatId: envelope.chatId,
          threadId: binding.thread_id,
        });
        this.store.audit({
          chatId: envelope.chatId,
          senderId: envelope.senderId,
          eventType: 'thread.missing_recreate',
          payload: { oldThreadId: binding.thread_id },
        });
        const recreated = await this.createNewThreadBinding(
          envelope,
          binding.workspace_id || this.getDefaultWorkspace().id,
        );
        await this.adapter.sendMessage(
          envelope.chatId,
          `## Status\nPrevious Codex thread was unavailable, so a new thread has been created.\n\n## Answer\nBound new thread ${recreated.thread_id}`,
        );
        return recreated;
      }
    }
    const workspaceId = binding?.workspace_id || this.getDefaultWorkspace().id;
    return this.createNewThreadBinding(envelope, workspaceId);
  }

  private async routeTurn(
    envelope: IncomingMessageEnvelope,
    binding: ChatBinding | null,
  ): Promise<void> {
    const current = await this.ensureThread(envelope, binding);
    const typingState = await this.addTypingIndicator(envelope.messageId);
    try {
      const inputs = toCodexInputs(envelope);
      if (!inputs.length) {
        await this.clearDirectTypingIndicator(typingState);
        await this.adapter.sendMessage(envelope.chatId, '## Answer\nNothing to send to Codex.');
        return;
      }

      const workspace = this.findWorkspace(current.workspace_id) || this.getDefaultWorkspace();
      const cwd = current.cwd || workspace.cwd;
      if (!isAllowedCwd(cwd, this.config.codex.workspace_roots, this.config.codex.allow_free_cwd)) {
        await this.clearDirectTypingIndicator(typingState);
        await this.adapter.sendMessage(
          envelope.chatId,
          `## Answer\nRefused to use cwd outside workspace roots: ${cwd}`,
        );
        return;
      }

      if (current.active_turn_id && current.state === 'turn_running') {
        let response;
        try {
          response = await this.runtime.steerTurn({
            threadId: current.thread_id,
            expectedTurnId: current.active_turn_id,
            input: inputs,
          });
        } catch (error) {
          if (!this.isThreadNotFoundError(error)) throw error;
          this.hydratedThreadIds.delete(current.thread_id);
          const recovered = await this.ensureThread(envelope, current);
          response = await this.runtime.startTurn({
            threadId: recovered.thread_id,
            input: inputs,
            cwd,
            model: recovered.model || workspace.default_model,
          });
          this.saveBinding({
            ...recovered,
            active_turn_id: response.turn.id,
            state: 'turn_running',
          });
          const buffer = this.getBuffer(response.turn.id);
          buffer.replyToMessageId = envelope.messageId;
          if (typingState) this.turnTypingStates.set(response.turn.id, typingState);
          buffer.statusText = '思考中...';
          this.scheduleFlush(recovered.thread_id, response.turn.id);
          return;
        }
        this.saveBinding({
          ...current,
          active_turn_id: response.turn.id,
          state: 'turn_running',
        });
        const buffer = this.getBuffer(response.turn.id);
        buffer.replyToMessageId = envelope.messageId;
        if (typingState) this.turnTypingStates.set(response.turn.id, typingState);
        buffer.statusText = '思考中...';
        this.scheduleFlush(current.thread_id, response.turn.id);
        return;
      }

      let response;
      try {
        response = await this.runtime.startTurn({
          threadId: current.thread_id,
          input: inputs,
          cwd,
          model: current.model || workspace.default_model,
        });
      } catch (error) {
        if (!this.isThreadNotFoundError(error)) throw error;
        this.hydratedThreadIds.delete(current.thread_id);
        const recovered = await this.ensureThread(envelope, current);
        response = await this.runtime.startTurn({
          threadId: recovered.thread_id,
          input: inputs,
          cwd: recovered.cwd || cwd,
          model: recovered.model || workspace.default_model,
        });
        this.saveBinding({
          ...recovered,
          active_turn_id: response.turn.id,
          state: 'turn_running',
        });
        const buffer = this.getBuffer(response.turn.id);
        buffer.replyToMessageId = envelope.messageId;
        if (typingState) this.turnTypingStates.set(response.turn.id, typingState);
        buffer.statusText = '思考中...';
        this.scheduleFlush(recovered.thread_id, response.turn.id);
        return;
      }
      this.saveBinding({
        ...current,
        active_turn_id: response.turn.id,
        state: 'turn_running',
      });
      const buffer = this.getBuffer(response.turn.id);
      buffer.replyToMessageId = envelope.messageId;
      if (typingState) this.turnTypingStates.set(response.turn.id, typingState);
      buffer.statusText = '思考中...';
      this.scheduleFlush(current.thread_id, response.turn.id);
    } catch (error) {
      await this.clearDirectTypingIndicator(typingState);
      throw error;
    }
  }

  private async replyToPending(
    envelope: IncomingMessageEnvelope,
    pending: PendingServerRequest,
  ): Promise<void> {
    const requestId = pending.request.id;
    const kind = pending.kind;
    const current = this.store.getBinding(envelope.chatId);

    if (kind === 'item/tool/requestUserInput') {
      const questions = Array.isArray(pending.request.params.questions)
        ? (pending.request.params.questions as Array<Record<string, unknown>>)
        : [];
      const answer = envelope.text.trim();
      const answers = Object.fromEntries(
        questions.map(question => [String(question.id), { answers: [answer] }]),
      );
      await this.runtime.replyUserInput(requestId, { answers });
      this.store.clearPendingRequest(pending.request_id);
      if (current) this.saveBinding({ ...current, state: 'turn_running' });
      await this.adapter.sendMessage(envelope.chatId, '## Answer\nReplied to Codex input request.');
      return;
    }

    const token = envelope.text.trim().toLowerCase();
    if (kind === 'item/permissions/requestApproval') {
      const params = pending.request.params as Record<string, unknown>;
      const scope = token === 'session' ? 'session' : 'turn';
      const permissions = token === 'deny' || token === 'cancel' ? {} : params.permissions || {};
      await this.runtime.replyApproval(requestId, { permissions, scope });
      this.store.clearPendingRequest(pending.request_id);
      if (current) this.saveBinding({ ...current, state: 'turn_running' });
      await this.adapter.sendMessage(envelope.chatId, `## Answer\nPermissions response sent (${scope}).`);
      return;
    }

    let decision: string = 'accept';
    if (token === 'session') decision = 'acceptForSession';
    if (token === 'deny') decision = 'decline';
    if (token === 'cancel') decision = 'cancel';
    await this.runtime.replyApproval(requestId, { decision });
    this.store.clearPendingRequest(pending.request_id);
    if (current) this.saveBinding({ ...current, state: 'turn_running' });
    await this.adapter.sendMessage(envelope.chatId, `## Answer\nApproval response sent (${decision}).`);
  }

  private async handleActionEnvelope(envelope: IncomingActionEnvelope): Promise<void> {
    const pending = this.store.getPendingRequest(envelope.chatId);
    if (!pending) {
      await this.adapter.sendMessage(envelope.chatId, '## Answer\nNo pending approval for this action.');
      return;
    }

    const current = this.store.getBinding(envelope.chatId);
    const action = String(envelope.action || '');
    if (pending.kind === 'item/tool/requestUserInput') {
      const resolved = this.resolveUserInputAction(pending, action);
      if (!resolved) {
        await this.adapter.sendMessage(envelope.chatId, '## Answer\nReply in chat with the requested input.');
        return;
      }
      await this.runtime.replyUserInput(pending.request.id, { answers: resolved.answers });
      this.store.clearPendingRequest(pending.request_id);
      if (current) this.saveBinding({ ...current, state: 'turn_running' });
      await this.adapter.sendMessage(
        envelope.chatId,
        `## Answer\nReplied to Codex input request${resolved.summary ? `: ${resolved.summary}` : '.'}`,
      );
      return;
    }

    let decision: string = 'accept';
    if (action.includes(':acceptForSession')) decision = 'acceptForSession';
    if (action.includes(':decline')) decision = 'decline';
    if (action.includes(':cancel')) decision = 'cancel';

    if (pending.kind === 'item/permissions/requestApproval') {
      const params = pending.request.params as Record<string, unknown>;
      await this.runtime.replyApproval(pending.request.id, {
        permissions: decision === 'decline' || decision === 'cancel' ? {} : params.permissions || {},
        scope: decision === 'acceptForSession' ? 'session' : 'turn',
      });
    } else {
      await this.runtime.replyApproval(pending.request.id, { decision });
    }

    this.store.clearPendingRequest(pending.request_id);
    if (current) this.saveBinding({ ...current, state: 'turn_running' });
    await this.adapter.sendMessage(envelope.chatId, `## Answer\nApproval response sent (${decision}).`);
  }

  private resolveUserInputAction(
    pending: PendingServerRequest,
    action: string,
  ): { answers: Record<string, { answers: string[] }>; summary: string } | null {
    const match = action.match(/^input:(.+?):answer:(.+?):(.+)$/);
    if (!match) return null;

    const [, requestId, questionIdRaw, optionIndexRaw] = match;
    if (String(pending.request.id) !== requestId) return null;
    const questionId = String(questionIdRaw || '').trim();
    if (!questionId) return null;

    const questions = Array.isArray(pending.request.params.questions)
      ? (pending.request.params.questions as Array<Record<string, unknown>>)
      : [];
    const question = questions.find(item => String(item.id || '') === questionId);
    if (!question) return null;

    const options = Array.isArray(question.options) ? (question.options as Array<Record<string, unknown>>) : [];
    const optionIndex = Number(optionIndexRaw);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) return null;

    const label = String(options[optionIndex]?.label || '').trim();
    if (!label) return null;

    return {
      answers: {
        [questionId]: {
          answers: [label],
        },
      },
      summary: label,
    };
  }

  private getBuffer(turnId: string): MessageBuffer {
    if (!this.turnBuffers.has(turnId)) {
      this.turnBuffers.set(turnId, new MessageBuffer());
    }
    return this.turnBuffers.get(turnId)!;
  }

  private async flushTurn(threadId: string, turnId: string): Promise<void> {
    const buffer = this.turnBuffers.get(turnId);
    const binding = this.store.findBindingByThread(threadId);
    if (!buffer || !binding) return;

    if (!buffer.messageId) {
      buffer.messageId = await this.adapter.sendMessage(binding.chat_id, buffer.markdown(), {
        replyToMessageId: buffer.replyToMessageId || undefined,
      });
      return;
    }
    await this.adapter.editMessage(binding.chat_id, buffer.messageId, buffer.markdown());
  }

  private scheduleFlush(threadId: string, turnId: string): void {
    const buffer = this.getBuffer(turnId);
    if (buffer.timer) return;
    buffer.timer = setTimeout(async () => {
      buffer.timer = null;
      await this.flushTurn(threadId, turnId);
    }, 600);
  }

  private async handleNotification(message: ServerNotificationMessage): Promise<void> {
    this.logger.debug('codex.notification', message);

    if (message.method === 'turn/started') {
      const binding = this.store.findBindingByThread(String(message.params.threadId || ''));
      const turn = (message.params.turn || {}) as Record<string, unknown>;
      if (binding) {
        this.saveBinding({
          ...binding,
          active_turn_id: String(turn.id || ''),
          state: 'turn_running',
        });
      }
      return;
    }

    if (message.method === 'thread/name/updated') {
      const binding = this.store.findBindingByThread(String(message.params.threadId || ''));
      if (binding) {
        this.saveBinding({
          ...binding,
          thread_name: String(message.params.name || binding.thread_name || ''),
        });
      }
      return;
    }

    if (message.method === 'command/exec/outputDelta') {
      const processId = String(message.params.processId || '');
      const tracked = this.execProcesses.get(processId);
      if (!tracked) return;
      const chunk = Buffer.from(String(message.params.deltaBase64 || ''), 'base64').toString('utf8');
      tracked.buffer += chunk;
      if (tracked.buffer.length > 3000) {
        await this.adapter.sendMessage(tracked.chatId, `## Commands\n${tracked.buffer.slice(-3000)}`);
        tracked.buffer = '';
      }
      return;
    }

    const turnId = applyNotificationToBuffer(this.logger, this.turnBuffers, message);
    if (turnId && message.params.threadId) {
      this.scheduleFlush(String(message.params.threadId), turnId);
    }

    if (message.method === 'turn/completed') {
      const binding = this.store.findBindingByThread(String(message.params.threadId || ''));
      const turn = (message.params.turn || {}) as Record<string, unknown>;
      const turnIdValue = String(turn.id || '');
      await this.flushTurn(String(message.params.threadId || ''), turnIdValue);
      await this.clearTypingIndicator(turnIdValue);
      this.turnBuffers.delete(turnIdValue);
      if (binding) {
        this.saveBinding({
          ...binding,
          active_turn_id: null,
          state: 'idle',
        });
      }
    }
  }

  private async handleServerRequest(message: ServerRequestMessage): Promise<void> {
    this.logger.info('codex.server_request', { method: message.method });
    const threadId = String(message.params.threadId || message.params.conversationId || '');
    const binding = this.store.findBindingByThread(threadId);
    if (!binding) {
      await this.runtime.replyApproval(message.id, { decision: 'cancel' });
      return;
    }

    const requestId = String(message.id);
    this.store.savePendingRequest(requestId, binding.chat_id, message.method, message);
    this.store.audit({
      chatId: binding.chat_id,
      senderId: binding.sender_id,
      eventType: 'server_request',
      payload: { method: message.method, params: message.params },
    });

    if (message.method === 'item/tool/requestUserInput') {
      await this.clearTypingIndicator(String(message.params.turnId || ''));
      const card = buildUserInputCard(message, { enableQuickActions: binding.plan_mode });
      binding.state = 'awaiting_user_input';
      this.saveBinding(binding);
      const turnId = String(message.params.turnId || '');
      const buffer = this.getBuffer(turnId);
      buffer.userInput = binding.plan_mode
        ? 'Choose an option from the card, or reply in chat if free-form input is needed.'
        : 'Reply in chat with the requested input.';
      if (this.adapter.sendCard) {
        await this.adapter.sendCard(binding.chat_id, card, {
          replyToMessageId: buffer.replyToMessageId || undefined,
        });
      } else {
        await this.adapter.sendMessage(binding.chat_id, buffer.markdown());
      }
      return;
    }

    const card = buildApprovalCard(message);
    await this.clearTypingIndicator(String(message.params.turnId || ''));
    binding.state = 'awaiting_approval';
    this.saveBinding(binding);
    const turnId = String(message.params.turnId || '');
    if (turnId) {
      const buffer = this.getBuffer(turnId);
      buffer.approval = 'Waiting for approval from Feishu.';
      this.scheduleFlush(binding.thread_id, turnId);
    }
    if (this.adapter.sendCard) {
      await this.adapter.sendCard(binding.chat_id, card, {
        replyToMessageId: turnId ? this.getBuffer(turnId).replyToMessageId || undefined : undefined,
      });
    } else {
      await this.adapter.sendMessage(binding.chat_id, '## Authorization\nApproval required.');
    }
  }
}
