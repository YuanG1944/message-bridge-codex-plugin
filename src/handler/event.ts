import type { LoggerLike, ServerNotificationMessage } from '../types.js';
import { MessageBuffer } from '../bridge/orchestrator/message-buffer.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function collectTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    const clean = value.trim();
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => collectTextFragments(item));
  }
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const directKeys = ['text', 'message', 'content', 'outputText', 'aggregatedOutput', 'summary', 'result'];
  const nestedKeys = ['parts', 'chunks', 'contentParts', 'messages', 'items'];
  const fragments: string[] = [];

  for (const key of directKeys) {
    fragments.push(...collectTextFragments(record[key]));
  }
  for (const key of nestedKeys) {
    fragments.push(...collectTextFragments(record[key]));
  }
  if (typeof record.type === 'string' && record.type === 'text') {
    fragments.push(...collectTextFragments(record.value));
  }

  return fragments;
}

function extractFinalAnswer(value: unknown): string {
  const seen = new Set<string>();
  const fragments = collectTextFragments(value).filter(fragment => {
    if (!fragment || seen.has(fragment)) return false;
    seen.add(fragment);
    return true;
  });
  return fragments.join('\n\n').trim();
}

function appendUniqueLine(target: string, line: string): string {
  const clean = line.trim();
  if (!clean) return target;
  const lines = target
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
  if (lines.includes(clean)) return target;
  return target ? `${target}\n${clean}` : clean;
}

function summarizeProgress(params: Record<string, unknown>): string {
  const tool = String(params.toolName || params.tool || params.name || 'tool');
  const status = String(params.status || params.phase || 'running');
  const message = String(params.message || params.summary || '').trim();
  return message ? `🔄 ${tool} · ${status} · ${message}` : `🔄 ${tool} · ${status}`;
}

function summarizePlan(params: Record<string, unknown>): string {
  const plan = Array.isArray(params.plan) ? params.plan : [];
  const lines = plan
    .map(item => asRecord(item))
    .map(item => {
      const step = String(item.step || '').trim();
      const status = String(item.status || '').trim();
      if (!step) return '';
      return `${status === 'completed' ? '✅' : status === 'in_progress' ? '🔄' : '•'} ${step}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

function summarizeItem(type: string, item: Record<string, unknown>, phase: 'started' | 'completed'): string {
  if (type === 'mcpToolCall') {
    const tool = String(item.tool || item.name || 'tool');
    const status = String(item.status || phase);
    return `${phase === 'completed' ? '✅' : '🔄'} ${tool} · ${status}`;
  }
  if (type === 'commandExecution') {
    const command = String(item.command || item.commandLine || '').trim();
    return `${phase === 'completed' ? '✅' : '🔄'} command${command ? ` · ${command}` : ''}`;
  }
  if (type === 'fileChange') {
    return `${phase === 'completed' ? '✅' : '🔄'} file changes`;
  }
  if (type === 'reasoning') {
    return `${phase === 'completed' ? '✅' : '🔄'} reasoning`;
  }
  return `${phase === 'completed' ? '✅' : '🔄'} ${type}`;
}

export function getOrCreateBuffer(store: Map<string, MessageBuffer>, turnId: string): MessageBuffer {
  const existing = store.get(turnId);
  if (existing) return existing;
  const buffer = new MessageBuffer();
  store.set(turnId, buffer);
  return buffer;
}

export function applyNotificationToBuffer(
  logger: LoggerLike,
  store: Map<string, MessageBuffer>,
  message: ServerNotificationMessage,
): string | null {
  switch (message.method) {
    case 'item/agentMessage/delta': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      buffer.statusText = '正在回答...';
      buffer.append('answer', String(message.params.delta || ''));
      return turnId;
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      buffer.statusText = '思考中...';
      buffer.append('reasoning', String(message.params.delta || ''));
      return turnId;
    }
    case 'item/commandExecution/outputDelta': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      buffer.statusText = '执行命令中...';
      buffer.append('commandOutput', String(message.params.delta || ''));
      return turnId;
    }
    case 'item/fileChange/outputDelta': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      buffer.statusText = '整理文件变更中...';
      buffer.append('fileChanges', String(message.params.delta || ''));
      return turnId;
    }
    case 'item/mcpToolCall/progress':
    case 'turn/plan/updated': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      buffer.statusText = '工具调用中...';
      const summary =
        message.method === 'turn/plan/updated'
          ? summarizePlan(asRecord(message.params))
          : summarizeProgress(asRecord(message.params));
      buffer.toolActivity = appendUniqueLine(buffer.toolActivity, summary);
      return turnId;
    }
    case 'turn/diff/updated': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      buffer.statusText = '整理变更中...';
      buffer.toolActivity = appendUniqueLine(buffer.toolActivity, '📝 diff updated');
      return turnId;
    }
    case 'item/started':
    case 'item/completed': {
      const turnId = String(message.params.turnId || '');
      const buffer = getOrCreateBuffer(store, turnId);
      const item = (message.params.item || {}) as Record<string, unknown>;
      const type = String(item.type || 'item');
      if (type === 'reasoning') buffer.statusText = '思考中...';
      if (type === 'commandExecution') buffer.statusText = '执行命令中...';
      if (type === 'mcpToolCall') buffer.statusText = '工具调用中...';
      if (type === 'commandExecution' && typeof item.aggregatedOutput === 'string') {
        buffer.commandOutput = String(item.aggregatedOutput);
      } else if (type === 'agentMessage') {
        const finalAnswer = extractFinalAnswer(item);
        if (finalAnswer) {
          buffer.statusText = '正在回答...';
          buffer.answer = finalAnswer;
        }
      } else if (type === 'fileChange' && Array.isArray(item.changes)) {
        buffer.fileChanges = (item.changes as unknown[]).map(change => JSON.stringify(change)).join('\n');
      } else if (type === 'mcpToolCall') {
        buffer.toolActivity = appendUniqueLine(
          buffer.toolActivity,
          summarizeItem(type, item, message.method === 'item/completed' ? 'completed' : 'started'),
        );
      } else if (type === 'enteredReviewMode' || type === 'exitedReviewMode') {
        buffer.toolActivity = appendUniqueLine(buffer.toolActivity, `${type}: ${String(item.review || '')}`);
      }
      buffer.toolActivity = appendUniqueLine(
        buffer.toolActivity,
        summarizeItem(type, item, message.method === 'item/completed' ? 'completed' : 'started'),
      );
      return turnId;
    }
    case 'turn/completed': {
      const turn = (message.params.turn || {}) as Record<string, unknown>;
      const turnId = String(turn.id || '');
      const buffer = getOrCreateBuffer(store, turnId);
      if (!buffer.answer) {
        const finalAnswer = extractFinalAnswer(turn);
        if (finalAnswer) {
          buffer.answer = finalAnswer;
        }
      }
      buffer.statusText = `Completed: ${String(turn.status || 'unknown')}`;
      buffer.finish();
      return turnId;
    }
    default:
      logger.debug('codex.notification.unhandled', message);
      return null;
  }
}
