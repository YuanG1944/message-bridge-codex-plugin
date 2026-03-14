import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { reviewTargetFromArgs } from '../src/handler/command.js';
import { applyNotificationToBuffer } from '../src/handler/event.js';
import { MessageBuffer } from '../src/bridge/orchestrator/message-buffer.js';
import {
  isAllowedCwd,
  parseSlashCommand,
  splitShellLikeArgs,
} from '../src/utils.js';
import type { LoggerLike, ServerNotificationMessage } from '../src/types.js';

const logger: LoggerLike = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe('command parsing', () => {
  test('parses slash commands and shell-like args', () => {
    expect(parseSlashCommand('/workspace repo-a')).toEqual({
      command: 'workspace',
      args: 'repo-a',
    });
    expect(parseSlashCommand('hello')).toBeNull();
    expect(splitShellLikeArgs('bun run "test file.ts" --watch')).toEqual([
      'bun',
      'run',
      'test file.ts',
      '--watch',
    ]);
  });

  test('maps review targets from text args', () => {
    expect(reviewTargetFromArgs('')).toEqual({ type: 'uncommittedChanges' });
    expect(reviewTargetFromArgs('abc1234')).toEqual({
      type: 'commit',
      sha: 'abc1234',
      title: null,
    });
    expect(reviewTargetFromArgs('branch main')).toEqual({
      type: 'baseBranch',
      branch: 'main',
    });
  });
});

describe('workspace guardrails', () => {
  test('allows only configured workspace roots unless free mode is enabled', () => {
    const root = path.resolve('/tmp/project');
    expect(isAllowedCwd(path.join(root, 'src'), [root], false)).toBe(true);
    expect(isAllowedCwd('/tmp/other', [root], false)).toBe(false);
    expect(isAllowedCwd('/tmp/other', [root], true)).toBe(true);
  });
});

describe('notification buffering', () => {
  test('maps app-server notifications into remote-console sections', () => {
    const store = new Map<string, MessageBuffer>();
    const messages: ServerNotificationMessage[] = [
      {
        jsonrpc: '2.0',
        method: 'item/reasoning/textDelta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'Thinking...' },
      },
      {
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'Answer.' },
      },
      {
        jsonrpc: '2.0',
        method: 'item/commandExecution/outputDelta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: '$ ls' },
      },
      {
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
      },
    ];

    for (const message of messages) {
      applyNotificationToBuffer(logger, store, message);
    }

    const buffer = store.get('turn-1');
    expect(buffer).toBeDefined();
    expect(buffer?.markdown()).toContain('## Thinking');
    expect(buffer?.markdown()).toContain('Thinking...');
    expect(buffer?.markdown()).toContain('## Answer');
    expect(buffer?.markdown()).toContain('Answer.');
    expect(buffer?.markdown()).toContain('## Commands');
    expect(buffer?.markdown()).toContain('$ ls');
    expect(buffer?.markdown()).toContain('Completed: completed');
    expect(buffer?.markdown()).toContain('耗时');
  });

  test('summarizes plan and tool activity into readable lines', () => {
    const store = new Map<string, MessageBuffer>();
    const messages: ServerNotificationMessage[] = [
      {
        jsonrpc: '2.0',
        method: 'turn/plan/updated',
        params: {
          turnId: 'turn-2',
          plan: [
            { step: 'Inspect files', status: 'completed' },
            { step: 'Patch renderer', status: 'in_progress' },
          ],
        },
      },
      {
        jsonrpc: '2.0',
        method: 'item/mcpToolCall/progress',
        params: {
          turnId: 'turn-2',
          toolName: 'host.capture_screen',
          status: 'running',
          message: 'capturing desktop',
        },
      },
    ];

    for (const message of messages) {
      applyNotificationToBuffer(logger, store, message);
    }

    const markdown = store.get('turn-2')?.markdown() || '';
    expect(markdown).toContain('✅ Inspect files');
    expect(markdown).toContain('🔄 Patch renderer');
    expect(markdown).toContain('host.capture_screen');
    expect(markdown).toContain('capturing desktop');
  });

  test('recovers final answer from completed events when no delta was streamed', () => {
    const store = new Map<string, MessageBuffer>();
    const messages: ServerNotificationMessage[] = [
      {
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          turnId: 'turn-3',
          item: {
            type: 'agentMessage',
            content: [{ type: 'text', text: '上海今天多云，16 到 24 摄氏度。' }],
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'turn-3', status: 'completed' } },
      },
    ];

    for (const message of messages) {
      applyNotificationToBuffer(logger, store, message);
    }

    const markdown = store.get('turn-3')?.markdown() || '';
    expect(markdown).toContain('上海今天多云');
    expect(markdown).toContain('Completed: completed');
  });
});
