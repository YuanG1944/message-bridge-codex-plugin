import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { SqliteStore } from '../src/store/sqlite-store.js';
import type { ChatBinding } from '../src/types.js';

const stores: SqliteStore[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createStore(): SqliteStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bridge-store-'));
  tempDirs.push(dir);
  const store = new SqliteStore(path.join(dir, 'bridge.db'));
  stores.push(store);
  return store;
}

describe('SqliteStore', () => {
  test('persists bindings and pending requests', () => {
    const store = createStore();
    const binding: ChatBinding = {
      chat_id: 'chat-1',
      sender_id: 'sender-1',
      chat_type: 'p2p',
      thread_id: 'thread-1',
      thread_name: 'Main Thread',
      workspace_id: 'workspace-a',
      model: 'gpt-5-codex',
      cwd: '/tmp/workspace-a',
      plan_mode: true,
      active_turn_id: 'turn-1',
      state: 'turn_running',
      save_file_next: true,
    };

    store.saveBinding(binding);
    store.savePendingRequest('req-1', 'chat-1', 'item/permissions/requestApproval', {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        permissions: { bash: { kind: 'allow' } },
      },
    });

    expect(store.getBinding('chat-1')).toMatchObject(binding);
    expect(store.findBindingByThread('thread-1')).toMatchObject(binding);
    expect(store.getPendingRequest('chat-1')).toMatchObject({
      request_id: 'req-1',
      chat_id: 'chat-1',
      kind: 'item/permissions/requestApproval',
    });

    store.clearPendingRequest('req-1');
    expect(store.getPendingRequest('chat-1')).toBeNull();
  });

  test('records audit entries and sender allowlist', () => {
    const store = createStore();
    store.addAllowedSender('sender-2');
    store.audit({
      chatId: 'chat-2',
      senderId: 'sender-2',
      eventType: 'thread.created',
      payload: { threadId: 'thread-2' },
    });

    expect(store.isAllowedSender('sender-2')).toBe(true);
    expect(store.listAudit('chat-2', 5)).toEqual([
      expect.objectContaining({
        chat_id: 'chat-2',
        sender_id: 'sender-2',
        event_type: 'thread.created',
        payload: { threadId: 'thread-2' },
      }),
    ]);
  });
});
