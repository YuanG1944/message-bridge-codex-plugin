import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SqliteStore } from './store/sqlite-store.js';
import { FeishuAdapter } from './feishu/feishu.adapter.js';
import { CodexAppServerClient } from './bridge/runtime/codex.app-server.js';
import { SessionOrchestrator } from './bridge/orchestrator/session-orchestrator.js';
import { ensureDir } from './utils/fs.js';

export async function startBridge() {
  const moduleDir = fileURLToPath(new URL('.', import.meta.url));
  const repoRoot =
    path.basename(moduleDir) === 'src' && path.basename(path.dirname(moduleDir)) === 'dist'
      ? path.resolve(moduleDir, '..', '..')
      : path.resolve(moduleDir, '..');
  const config = loadConfig();

  await ensureDir(config.storage.files_dir);
  const logger = createLogger({
    filePath: config.storage.log_file,
    level: process.env.BRIDGE_DEBUG ? 'debug' : 'info',
  });

  const store = new SqliteStore(config.storage.database_path);
  for (const senderId of config.security.allowed_sender_ids) {
    store.addAllowedSender(senderId);
  }

  const adapter = new FeishuAdapter({
    config: config.feishu,
    logger,
    filesDir: config.storage.files_dir,
    allowedFileRoots: [...config.codex.workspace_roots, config.storage.files_dir],
  });

  const runtime = new CodexAppServerClient({
    config,
    logger,
    repoRoot,
  });

  const orchestrator = new SessionOrchestrator({
    config,
    logger,
    store,
    adapter,
    runtime,
  });

  await runtime.start();
  await orchestrator.start();
  await adapter.start(envelope => orchestrator.handleEnvelope(envelope));
  logger.info('bridge.started', {
    mode: config.feishu.mode,
    codexCwd: config.codex.cwd,
  });

  return { config, logger, store, adapter, runtime, orchestrator };
}
