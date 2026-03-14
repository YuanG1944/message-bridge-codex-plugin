import fs from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import type {
  AuditLogEntry,
  ChatBinding,
  PendingRequestKind,
  PendingServerRequest,
  SqliteStatements,
} from '../types.js';

export class SqliteStore {
  private db: Database;
  private statements: SqliteStatements;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chat_binding (
        chat_id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        chat_type TEXT NOT NULL DEFAULT 'unknown',
        thread_id TEXT NOT NULL,
        thread_name TEXT,
        workspace_id TEXT,
        model TEXT,
        cwd TEXT,
        plan_mode INTEGER NOT NULL DEFAULT 0,
        active_turn_id TEXT,
        state TEXT NOT NULL DEFAULT 'idle',
        save_file_next INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_request (
        request_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT,
        is_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allowed_sender (
        sender_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT,
        sender_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('chat_binding', 'plan_mode', 'INTEGER NOT NULL DEFAULT 0');

    this.statements = {
      getBinding: this.db.prepare('SELECT * FROM chat_binding WHERE chat_id = ?'),
      upsertBinding: this.db.prepare(`
        INSERT INTO chat_binding (
          chat_id, sender_id, chat_type, thread_id, thread_name, workspace_id, model, cwd,
          plan_mode, active_turn_id, state, save_file_next, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          sender_id = excluded.sender_id,
          chat_type = excluded.chat_type,
          thread_id = excluded.thread_id,
          thread_name = excluded.thread_name,
          workspace_id = excluded.workspace_id,
          model = excluded.model,
          cwd = excluded.cwd,
          plan_mode = excluded.plan_mode,
          active_turn_id = excluded.active_turn_id,
          state = excluded.state,
          save_file_next = excluded.save_file_next,
          updated_at = excluded.updated_at
      `),
      setPendingRequest: this.db.prepare(`
        INSERT INTO pending_request (request_id, chat_id, kind, request_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
          chat_id = excluded.chat_id,
          kind = excluded.kind,
          request_json = excluded.request_json,
          created_at = excluded.created_at
      `),
      getPendingByChat: this.db.prepare(
        'SELECT * FROM pending_request WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1',
      ),
      deletePending: this.db.prepare('DELETE FROM pending_request WHERE request_id = ?'),
      insertAttachment: this.db.prepare(`
        INSERT INTO attachment (chat_id, message_id, file_path, mime_type, is_image, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      insertAllowedSender: this.db.prepare(
        'INSERT OR IGNORE INTO allowed_sender (sender_id, created_at) VALUES (?, ?)',
      ),
      getAllowedSender: this.db.prepare('SELECT sender_id FROM allowed_sender WHERE sender_id = ?'),
      insertAudit: this.db.prepare(`
        INSERT INTO audit_log (chat_id, sender_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      listAudit: this.db.prepare('SELECT * FROM audit_log WHERE chat_id = ? ORDER BY id DESC LIMIT ?'),
      findByThread: this.db.prepare('SELECT * FROM chat_binding WHERE thread_id = ? LIMIT 1'),
    };
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name?: unknown }>;
    const exists = columns.some(item => String(item.name || '') === column);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  getBinding(chatId: string): ChatBinding | null {
    const row = this.statements.getBinding.get(chatId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      ...(row as unknown as ChatBinding),
      plan_mode: Boolean(row.plan_mode),
      save_file_next: Boolean(row.save_file_next),
    };
  }

  findBindingByThread(threadId: string): ChatBinding | null {
    const row = this.statements.findByThread.get(threadId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      ...(row as unknown as ChatBinding),
      plan_mode: Boolean(row.plan_mode),
      save_file_next: Boolean(row.save_file_next),
    };
  }

  saveBinding(binding: ChatBinding): void {
    const now = new Date().toISOString();
    const existing = this.getBinding(binding.chat_id);
    this.statements.upsertBinding.run(
      binding.chat_id,
      binding.sender_id,
      binding.chat_type,
      binding.thread_id,
      binding.thread_name || null,
      binding.workspace_id || null,
      binding.model || null,
      binding.cwd || null,
      binding.plan_mode ? 1 : 0,
      binding.active_turn_id || null,
      binding.state || 'idle',
      binding.save_file_next ? 1 : 0,
      existing?.created_at || now,
      now,
    );
  }

  getPendingRequest(chatId: string): PendingServerRequest | null {
    const row = this.statements.getPendingByChat.get(chatId) as Record<string, unknown> | null;
    if (!row) return null;
    const request_json = String(row.request_json || '{}');
    return {
      ...(row as unknown as PendingServerRequest),
      request_json,
      request: JSON.parse(request_json) as PendingServerRequest['request'],
    };
  }

  savePendingRequest(
    requestId: string,
    chatId: string,
    kind: PendingRequestKind,
    request: PendingServerRequest['request'],
  ): void {
    this.statements.setPendingRequest.run(
      requestId,
      chatId,
      kind,
      JSON.stringify(request),
      new Date().toISOString(),
    );
  }

  clearPendingRequest(requestId: string): void {
    this.statements.deletePending.run(requestId);
  }

  saveAttachment(args: {
    chatId: string;
    messageId: string;
    filePath: string;
    mimeType?: string;
    isImage: boolean;
  }): void {
    this.statements.insertAttachment.run(
      args.chatId,
      args.messageId,
      args.filePath,
      args.mimeType || null,
      args.isImage ? 1 : 0,
      new Date().toISOString(),
    );
  }

  addAllowedSender(senderId: string): void {
    this.statements.insertAllowedSender.run(senderId, new Date().toISOString());
  }

  isAllowedSender(senderId: string): boolean {
    return Boolean(this.statements.getAllowedSender.get(senderId));
  }

  audit(args: {
    chatId?: string | null;
    senderId?: string | null;
    eventType: string;
    payload: unknown;
  }): void {
    this.statements.insertAudit.run(
      args.chatId || null,
      args.senderId || null,
      args.eventType,
      JSON.stringify(args.payload),
      new Date().toISOString(),
    );
  }

  listAudit(chatId: string, limit = 20): AuditLogEntry[] {
    return (this.statements.listAudit.all(chatId, limit) as Array<Record<string, unknown>>).map(
      row => ({
        ...(row as unknown as AuditLogEntry),
        payload: JSON.parse(String(row.payload_json)),
      }),
    );
  }

  close(): void {
    this.db.close();
  }
}
