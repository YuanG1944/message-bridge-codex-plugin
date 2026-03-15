import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { marked, Renderer } from 'marked';
import type { IncomingEnvelope, FeishuAdapterCtor, FeishuApiOptions, FeishuCard, FeishuCardKit } from '../types.js';
import { loadDetailPayload } from './detail-cache.js';
import { safeJsonParse, verifyFeishuRequest } from './signature.js';

type LarkModule = typeof import('@larksuiteoapi/node-sdk');
const FEISHU_CALLBACK_PATH = '/feishu/webhook';
const LOCAL_FILE_VIEW_PATH = '/bridge/file';
const LOCAL_DETAIL_VIEW_PATH = '/bridge/detail';
const FEISHU_HTTP_TIMEOUT_MS = 15_000;
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCodeBlock(code: string, language?: string): string {
  return `<pre><code class="lang-${escapeHtml(language || 'plain')}">${escapeHtml(code)}</code></pre>`;
}

function buildPreviewHtml(params: {
  title: string;
  badge: string;
  meta: string;
  preview: string;
  source: string;
  rawContent?: string;
  line?: string;
}): string {
  const { title, badge, meta, preview, source, rawContent = '', line } = params;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: linear-gradient(180deg, #f7f1e5 0%, #efe6d7 100%); color: #1f2937; font-family: Georgia, "Iowan Old Style", serif; }
    header { padding: 18px 20px; background: rgba(20, 52, 43, 0.96); color: #f8f4ea; position: sticky; top: 0; backdrop-filter: blur(12px); border-bottom: 1px solid rgba(217, 201, 163, 0.28); z-index: 10; }
    header .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    header .meta { opacity: 0.85; font-size: 12px; margin-top: 8px; word-break: break-all; font-family: Menlo, Monaco, monospace; }
    .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; background: #d9c9a3; color: #14342b; font-size: 12px; }
    .pill { display: inline-block; padding: 3px 9px; border-radius: 999px; background: rgba(248, 244, 234, 0.12); color: #f8f4ea; font-size: 12px; }
    main { padding: 22px 18px 32px; max-width: 1080px; margin: 0 auto; }
    .surface { background: rgba(255, 252, 246, 0.88); border: 1px solid rgba(20, 52, 43, 0.08); border-radius: 18px; box-shadow: 0 12px 40px rgba(20, 52, 43, 0.08); overflow: hidden; }
    .toolbar { display: flex; gap: 8px; padding: 14px 14px 0; flex-wrap: wrap; }
    .tab { appearance: none; border: 0; background: #e8dcc6; color: #14342b; padding: 8px 12px; border-radius: 10px; cursor: pointer; font: 600 13px/1.1 ui-sans-serif, system-ui, sans-serif; }
    .tab.active { background: #14342b; color: #f8f4ea; }
    .copy-btn { appearance: none; border: 0; background: #d9c9a3; color: #14342b; padding: 8px 12px; border-radius: 10px; cursor: pointer; font: 600 13px/1.1 ui-sans-serif, system-ui, sans-serif; }
    .panel { display: none; padding: 18px; }
    .panel.active { display: block; }
    .doc { font-size: 18px; line-height: 1.72; }
    .doc pre { margin: 18px 0; padding: 14px; white-space: pre-wrap; word-break: break-word; line-height: 1.6; font-size: 13px; background: #f3eadb; border-radius: 12px; overflow-x: auto; font-family: Menlo, Monaco, monospace; position: relative; }
    .doc code { font-family: Menlo, Monaco, monospace; background: rgba(20, 52, 43, 0.06); padding: 0.12em 0.32em; border-radius: 6px; }
    .doc pre code { background: transparent; padding: 0; border-radius: 0; }
    .code-copy { position: absolute; top: 10px; right: 10px; appearance: none; border: 0; background: rgba(20, 52, 43, 0.88); color: #f8f4ea; padding: 6px 8px; border-radius: 8px; cursor: pointer; font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; }
    .doc blockquote { margin: 18px 0; padding: 6px 16px; border-left: 4px solid #c7b48a; color: #5b6470; background: rgba(199, 180, 138, 0.12); }
    .doc table { border-collapse: collapse; width: 100%; margin: 18px 0; background: #fffdf9; font-size: 15px; }
    .doc th, .doc td { border: 1px solid #d9c9a3; padding: 8px 10px; text-align: left; vertical-align: top; }
    .doc h1, .doc h2, .doc h3, .doc h4, .doc h5 { color: #14342b; line-height: 1.18; margin-top: 1.4em; }
    .doc h1 { font-size: 2.1rem; }
    .doc h2 { font-size: 1.6rem; }
    .doc h3 { font-size: 1.3rem; }
    .doc img { max-width: 100%; height: auto; border-radius: 12px; }
    .doc a { color: #0c6b58; text-decoration: none; }
    .doc a:hover { text-decoration: underline; }
    .source-wrap { background: #fbf7ef; border-radius: 14px; border: 1px solid rgba(20, 52, 43, 0.08); overflow: auto; }
    .source-table { width: 100%; border-collapse: collapse; font-family: Menlo, Monaco, monospace; font-size: 13px; line-height: 1.6; }
    .source-table td { padding: 0; vertical-align: top; }
    .line-no { width: 1%; user-select: none; white-space: nowrap; color: #8a7b61; text-align: right; padding: 0 12px; border-right: 1px solid rgba(20, 52, 43, 0.08); background: rgba(20, 52, 43, 0.03); }
    .line-no a { color: inherit; text-decoration: none; display: block; padding: 0; }
    .line-no a:hover { color: #14342b; }
    .line-code { padding: 0 14px; white-space: pre-wrap; word-break: break-word; }
    .source-line { scroll-margin-top: 90px; }
    .source-line:hover td { background: rgba(217, 201, 163, 0.22); }
    .source-line.highlight td { background: rgba(217, 201, 163, 0.42); }
    .source-line.highlight .line-no { color: #14342b; font-weight: 700; }
    .helper { padding: 0 18px 18px; font: 12px/1.5 ui-sans-serif, system-ui, sans-serif; color: #6b7280; }
    .toast { position: fixed; right: 16px; bottom: 16px; background: rgba(20, 52, 43, 0.92); color: #f8f4ea; padding: 10px 12px; border-radius: 10px; font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; opacity: 0; transform: translateY(8px); transition: opacity .18s ease, transform .18s ease; pointer-events: none; }
    .toast.show { opacity: 1; transform: translateY(0); }
    @media (max-width: 720px) {
      main { padding: 14px 10px 24px; }
      .panel { padding: 14px; }
      .doc { font-size: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="row">
      <strong>${escapeHtml(title)}</strong>
      <span class="badge">${escapeHtml(badge)}</span>
      ${line ? `<span class="pill">Line ${escapeHtml(line)}</span>` : ''}
    </div>
    <div class="meta">${escapeHtml(meta)}</div>
  </header>
  <main>
    <section class="surface">
      <div class="toolbar">
        <button class="tab active" type="button" data-target="preview-panel">Preview</button>
        <button class="tab" type="button" data-target="source-panel">Source</button>
        <button class="copy-btn" type="button" id="copy-all">复制全文</button>
      </div>
      <section id="preview-panel" class="panel active">
        <article class="doc">${preview}</article>
      </section>
      <section id="source-panel" class="panel">
        <div class="source-wrap">${source}</div>
      </section>
      <div class="helper">Tip: switch to Source to inspect the raw file with line numbers.${line ? ` Line ${escapeHtml(line)} is highlighted automatically.` : ''}</div>
    </section>
  </main>
  <div class="toast" id="toast">已复制</div>
  <script>
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const panels = Array.from(document.querySelectorAll('.panel'));
    const rawContent = ${JSON.stringify(rawContent)};
    const toast = document.getElementById('toast');
    const showToast = (text) => {
      if (!toast) return;
      toast.textContent = text;
      toast.classList.add('show');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove('show'), 1400);
    };
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        tabs.forEach((item) => item.classList.toggle('active', item === tab));
        panels.forEach((panel) => panel.classList.toggle('active', panel.id === target));
      });
    });
    const copy = async (text, button) => {
      try {
        await navigator.clipboard.writeText(text);
        if (button) {
          const old = button.textContent;
          button.textContent = '已复制';
          setTimeout(() => { button.textContent = old; }, 1200);
        }
        showToast('已复制到剪贴板');
      } catch {}
    };
    document.getElementById('copy-all')?.addEventListener('click', (event) => {
      copy(rawContent, event.currentTarget);
    });
    document.querySelectorAll('.doc pre').forEach((block) => {
      const code = block.querySelector('code');
      if (!code) return;
      const button = document.createElement('button');
      button.className = 'code-copy';
      button.type = 'button';
      button.textContent = '复制代码';
      button.addEventListener('click', () => copy(code.innerText, button));
      block.appendChild(button);
    });
    document.querySelectorAll('.line-no a').forEach((anchor) => {
      anchor.addEventListener('click', async (event) => {
        event.preventDefault();
        const href = anchor.getAttribute('href');
        if (!href) return;
        const url = new URL(window.location.href);
        url.hash = href;
        await navigator.clipboard.writeText(url.toString());
        history.replaceState(null, '', href);
        showToast('行链接已复制');
      });
    });
    const highlighted = document.querySelector('.source-line.highlight');
    if (highlighted) {
      setTimeout(() => highlighted.scrollIntoView({ block: 'center' }), 60);
    }
  </script>
</body>
</html>`;
}

function decodeBase64Url(input: string): string {
  if (!input) return '';
  try {
    return Buffer.from(input, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function buildDetailPreview(params: { content: string; kind: string }): string {
  const { content, kind } = params;
  if (kind === 'answer') return String(marked.parse(content || ''));
  if (kind === 'commands') return renderCodeBlock(content, 'bash');
  if (kind === 'files') return renderCodeBlock(content, 'text');
  if (kind === 'status') return `<div class="doc"><p>${escapeHtml(content).replace(/\n/g, '<br>')}</p></div>`;
  return `<div class="doc">${String(marked.parse(content || ''))}</div>`;
}

function buildSourceTable(content: string, highlightLine?: number | null): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const rows = lines
    .map((line, index) => {
      const lineNumber = index + 1;
      const highlight = highlightLine === lineNumber ? ' highlight' : '';
      return `<tr id="L${lineNumber}" class="source-line${highlight}"><td class="line-no"><a href="#L${lineNumber}" title="复制这一行的链接">${lineNumber}</a></td><td class="line-code">${escapeHtml(line || ' ')}</td></tr>`;
    })
    .join('');
  return `<table class="source-table"><tbody>${rows}</tbody></table>`;
}

function buildLocalPreviewHref(params: {
  callbackUrl: string;
  currentFilePath: string;
  href: string;
}): string | null {
  const { callbackUrl, currentFilePath, href } = params;
  if (!href) return null;
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;

  const [rawPath, hash = ''] = href.split('#');
  const safeRawPath = rawPath || '';
  const lineMatch = safeRawPath.match(/^(.*?)(?::(\d+))?$/);
  const pathPart = lineMatch?.[1] || safeRawPath;
  const line = lineMatch?.[2];
  if (!pathPart) return href;

  const resolved = path.resolve(path.dirname(currentFilePath), pathPart);
  const url = new URL(LOCAL_FILE_VIEW_PATH, callbackUrl);
  url.searchParams.set('path', resolved);
  if (line) url.searchParams.set('line', line);
  if (hash) url.hash = hash;
  return url.toString();
}

function createMarkedRenderer(params: {
  callbackUrl: string;
  currentFilePath: string;
}): Renderer {
  const { callbackUrl, currentFilePath } = params;
  const renderer = new Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const text = marked.Parser.parseInline(tokens);
    const slug = text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `<h${depth} id="${escapeHtml(slug || `section-${depth}`)}">${text}</h${depth}>`;
  };
  renderer.code = ({ text, lang }) => renderCodeBlock(text, lang);
  renderer.link = ({ href, title, tokens }) => {
    const text = marked.Parser.parseInline(tokens);
    const targetHref = buildLocalPreviewHref({
      callbackUrl,
      currentFilePath,
      href: href || '',
    });
    const attrs = [
      `href="${escapeHtml(targetHref || href || '#')}"`,
      title ? `title="${escapeHtml(title)}"` : '',
      /^(https?:|mailto:|tel:)/i.test(targetHref || '') ? 'target="_blank" rel="noreferrer"' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<a ${attrs}>${text}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const targetHref = buildLocalPreviewHref({
      callbackUrl,
      currentFilePath,
      href: href || '',
    });
    if (!targetHref) return escapeHtml(text || '');
    const attrs = [
      `src="${escapeHtml(targetHref)}"`,
      `alt="${escapeHtml(text || '')}"`,
      title ? `title="${escapeHtml(title)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<img ${attrs} />`;
  };
  return renderer;
}

function isPathWithinRoots(targetPath: string, roots: string[]): boolean {
  const normalized = path.resolve(targetPath);
  return roots.some(root => {
    const resolvedRoot = path.resolve(root);
    return normalized === resolvedRoot || normalized.startsWith(`${resolvedRoot}${path.sep}`);
  });
}

async function importLarkSdk(): Promise<LarkModule> {
  return import('@larksuiteoapi/node-sdk');
}

function parsePort(callbackUrl: string, fallbackPort: number): number {
  try {
    return Number(new URL(callbackUrl).port || fallbackPort);
  } catch {
    return fallbackPort;
  }
}

function normalizeRequestPath(url: string | undefined): string {
  if (!url) return '/';
  try {
    return new URL(url, 'http://127.0.0.1').pathname || '/';
  } catch {
    return '/';
  }
}

function isAcceptedCallbackPath(requestPath: string): boolean {
  return requestPath === '/' || requestPath === FEISHU_CALLBACK_PATH;
}

function asTextMessage(content: unknown): string {
  if (content && typeof content === 'object' && typeof (content as { text?: string }).text === 'string') {
    return (content as { text: string }).text;
  }
  const parsed = safeJsonParse<Record<string, unknown>>(String(content || ''), {});
  return typeof parsed.text === 'string' ? parsed.text : '';
}

function buildPostPayload(markdown: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text: markdown || ' ' }]],
    },
  });
}

function normalizeFileName(messageId: string, rawName: string): string {
  return `${messageId}-${rawName || 'file'}`;
}

function decryptEvent(encrypted: string, encryptKey: string): string {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  const iv = encryptedBuffer.subarray(0, 16);
  const ciphertext = encryptedBuffer.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const processedMessageIds = new Set<string>();

export class FeishuClient {
  private readonly config;
  private readonly logger;
  private readonly filesDir;
  private readonly allowedFileRoots;
  private httpServer: http.Server | null;
  private wsClient: { start(args: unknown): Promise<void> } | null;
  private sdkClient: Record<string, unknown> | null;
  private tenantToken: string | null;
  private tenantTokenExpiresAt: number;
  private readonly cardKitSequences = new Map<string, number>();
  private readonly cardKitUpdateQueues = new Map<string, Promise<void>>();

  constructor(input: FeishuAdapterCtor) {
    this.config = input.config;
    this.logger = input.logger;
    this.filesDir = input.filesDir;
    this.allowedFileRoots = [...new Set([...(input.allowedFileRoots || []), input.filesDir].filter(Boolean))];
    this.httpServer = null;
    this.wsClient = null;
    this.sdkClient = null;
    this.tenantToken = null;
    this.tenantTokenExpiresAt = 0;
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
  }

  async start(onEnvelope: (envelope: IncomingEnvelope) => Promise<void>): Promise<void> {
    await fs.mkdir(this.filesDir, { recursive: true });
    await this.startCallbackServer(onEnvelope);
    if (this.config.mode === 'ws') {
      await this.startWebsocket(onEnvelope);
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
      this.httpServer = null;
    });
  }

  private async getTenantToken(): Promise<string> {
    if (this.tenantToken && this.tenantTokenExpiresAt > Date.now() + 60_000) return this.tenantToken;

    this.logger.info('feishu.api.request', {
      method: 'POST',
      url: '/open-apis/auth/v3/tenant_access_token/internal',
    });
    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        signal: AbortSignal.timeout(FEISHU_HTTP_TIMEOUT_MS),
        body: JSON.stringify({
          app_id: this.config.app_id,
          app_secret: this.config.app_secret,
        }),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;
    this.logger.info('feishu.api.response', {
      method: 'POST',
      url: '/open-apis/auth/v3/tenant_access_token/internal',
      code: Number(body.code || response.status),
    });
    if (!response.ok || body.code !== 0) {
      throw new Error(`Failed to refresh Feishu tenant token: ${JSON.stringify(body)}`);
    }
    this.tenantToken = String(body.tenant_access_token || '');
    this.tenantTokenExpiresAt =
      Date.now() + Number(body.expire || body.expire_in || 7200) * 1000;
    return this.tenantToken;
  }

  private async getSdkClient(): Promise<Record<string, unknown>> {
    if (this.sdkClient) return this.sdkClient;
    const lark = await importLarkSdk();
    const client = new lark.Client({
      appId: this.config.app_id,
      appSecret: this.config.app_secret,
      loggerLevel: lark.LoggerLevel.info,
    }) as unknown as Record<string, unknown>;
    this.sdkClient = client;
    return client;
  }

  private encodeCardKitRef(messageId: string, cardId: string): string {
    return `cardkit:${messageId}:${cardId}`;
  }

  private decodeCardKitRef(value: string): { messageId: string; cardId: string } | null {
    if (!value.startsWith('cardkit:')) return null;
    const body = value.slice('cardkit:'.length);
    const separator = body.indexOf(':');
    if (separator === -1) return null;
    return {
      messageId: body.slice(0, separator),
      cardId: body.slice(separator + 1),
    };
  }

  private async createCardKitEntity(card: FeishuCardKit): Promise<string> {
    const client = await this.getSdkClient();
    const cardkit = (((client.cardkit as Record<string, unknown>)?.v1 as Record<string, unknown>)?.card ||
      {}) as Record<string, unknown>;
    const create = cardkit.create as
      | ((args: {
          data: {
            type: 'card_json';
            data: string;
          };
        }) => Promise<Record<string, unknown>>)
      | undefined;
    if (!create) {
      throw new Error('Feishu CardKit create API is unavailable in the installed SDK.');
    }
    const response = await create({
      data: {
        type: 'card_json',
        data: JSON.stringify(card),
      },
    });
    const data = (response.data || response) as Record<string, unknown>;
    const cardId = String(data.card_id || '');
    if (!cardId) {
      throw new Error(`CardKit create returned no card_id: ${JSON.stringify(response)}`);
    }
    return cardId;
  }

  private async updateCardKitEntity(cardId: string, card: FeishuCardKit, sequence: number): Promise<void> {
    const client = await this.getSdkClient();
    const cardkit = (((client.cardkit as Record<string, unknown>)?.v1 as Record<string, unknown>)?.card ||
      {}) as Record<string, unknown>;
    const update = cardkit.update as
      | ((args: {
          data: {
            card: {
              type: 'card_json';
              data: string;
            };
            sequence: number;
          };
          path: { card_id: string };
        }) => Promise<Record<string, unknown>>)
      | undefined;
    if (!update) {
      throw new Error('Feishu CardKit update API is unavailable in the installed SDK.');
    }
    const response = await update({
      data: {
        card: {
          type: 'card_json',
          data: JSON.stringify(card),
        },
        sequence,
      },
      path: { card_id: cardId },
    });
    const code = Number((response as { code?: unknown }).code || 0);
    if (code && code !== 0) {
      throw new Error(`CardKit update failed: ${JSON.stringify(response)}`);
    }
  }

  private async api(
    pathname: string,
    options: FeishuApiOptions = {},
  ): Promise<Record<string, unknown>> {
    const token = await this.getTenantToken();
    const method = options.method || 'GET';
    this.logger.info('feishu.api.request', { method, url: pathname });
    try {
      const response = await fetch(`https://open.feishu.cn${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
        },
        signal: AbortSignal.timeout(FEISHU_HTTP_TIMEOUT_MS),
        body: options.body,
      });
      const text = await response.text();
      const payload = safeJsonParse<Record<string, unknown>>(text, { code: -1, msg: text });
      this.logger.info('feishu.api.response', {
        method,
        url: pathname,
        code: Number(payload.code || response.status),
      });
      if (!response.ok || payload.code !== 0) {
        throw new Error(`Feishu API ${pathname} failed: ${text.slice(0, 500)}`);
      }
      return payload;
    } catch (error) {
      this.logger.error('feishu.api.error', {
        method,
        url: pathname,
        error: String((error as Error)?.stack || error),
      });
      throw error;
    }
  }

  async sendMessage(
    chatId: string,
    cardJson: string,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null> {
    const maybeCardKit = safeJsonParse<Record<string, unknown>>(cardJson, {});
    if (maybeCardKit.schema === '2.0') {
      return this.sendCardKitMessage(chatId, maybeCardKit as unknown as FeishuCardKit, options);
    }
    const endpoint = options?.replyToMessageId
      ? `/open-apis/im/v1/messages/${options.replyToMessageId}/reply`
      : '/open-apis/im/v1/messages?receive_id_type=chat_id';
    const payload = await this.api(endpoint, {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(
        options?.replyToMessageId
          ? {
              msg_type: 'interactive',
              content: cardJson,
              reply_in_thread: options.replyInThread,
            }
          : {
              receive_id: chatId,
              msg_type: 'interactive',
              content: cardJson,
            },
      ),
    });
    return String(((payload.data as Record<string, unknown> | undefined)?.message_id || '') || '') || null;
  }

  async sendCard(
    chatId: string,
    card: FeishuCard | FeishuCardKit,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null> {
    if ((card as FeishuCardKit).schema === '2.0') {
      return this.sendCardKitMessage(chatId, card as FeishuCardKit, options);
    }
    const endpoint = options?.replyToMessageId
      ? `/open-apis/im/v1/messages/${options.replyToMessageId}/reply`
      : '/open-apis/im/v1/messages?receive_id_type=chat_id';
    const payload = await this.api(endpoint, {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(
        options?.replyToMessageId
          ? {
              msg_type: 'interactive',
              content: JSON.stringify(card),
              reply_in_thread: options.replyInThread,
            }
          : {
              receive_id: chatId,
              msg_type: 'interactive',
              content: JSON.stringify(card),
            },
      ),
    });
    return String(((payload.data as Record<string, unknown> | undefined)?.message_id || '') || '') || null;
  }

  async sendPostMessage(
    chatId: string,
    markdown: string,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null> {
    const endpoint = options?.replyToMessageId
      ? `/open-apis/im/v1/messages/${options.replyToMessageId}/reply`
      : '/open-apis/im/v1/messages?receive_id_type=chat_id';
    const payload = await this.api(endpoint, {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(
        options?.replyToMessageId
          ? {
              msg_type: 'post',
              content: buildPostPayload(markdown),
              reply_in_thread: options.replyInThread,
            }
          : {
              receive_id: chatId,
              msg_type: 'post',
              content: buildPostPayload(markdown),
            },
      ),
    });
    return String(((payload.data as Record<string, unknown> | undefined)?.message_id || '') || '') || null;
  }

  async editMessage(_chatId: string, messageId: string, cardJson: string): Promise<boolean> {
    const cardKitRef = this.decodeCardKitRef(messageId);
    const maybeCardKit = safeJsonParse<Record<string, unknown>>(cardJson, {});
    if (cardKitRef && maybeCardKit.schema === '2.0') {
      const previous = this.cardKitUpdateQueues.get(messageId) || Promise.resolve();
      const currentSequence = this.cardKitSequences.get(messageId) || 1;
      const nextSequence = currentSequence + 1;
      this.cardKitSequences.set(messageId, nextSequence);
      const updatePromise = previous
        .catch(() => undefined)
        .then(() =>
          this.updateCardKitEntity(cardKitRef.cardId, maybeCardKit as unknown as FeishuCardKit, nextSequence),
        );
      this.cardKitUpdateQueues.set(messageId, updatePromise);
      await updatePromise;
      return true;
    }
    const payload = await this.api(`/open-apis/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        content: cardJson,
      }),
    });
    return payload.code === 0;
  }

  async updateCard(messageId: string, card: FeishuCard): Promise<boolean> {
    const payload = await this.api(`/open-apis/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ content: JSON.stringify(card) }),
    });
    return payload.code === 0;
  }

  async sendFile(chatId: string, localPath: string): Promise<boolean> {
    const filename = path.basename(localPath);
    const buffer = await fs.readFile(localPath);
    const token = await this.getTenantToken();
    const form = new FormData();
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(filename);

    if (isImage) {
      form.append('image_type', 'message');
      form.append('image', new Blob([buffer]), filename);
      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok || body.code !== 0) {
        throw new Error(`Failed to upload image: ${JSON.stringify(body)}`);
      }
      await this.api('/open-apis/im/v1/messages?receive_id_type=chat_id', {
        method: 'POST',
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'image',
          content: JSON.stringify({
            image_key: (body.data as Record<string, unknown> | undefined)?.image_key || body.image_key,
          }),
        }),
      });
      return true;
    }

    form.append('file_type', 'stream');
    form.append('file_name', filename);
    form.append('file', new Blob([buffer]), filename);
    const response = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body.code !== 0) {
      throw new Error(`Failed to upload file: ${JSON.stringify(body)}`);
    }
    await this.api('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'file',
        content: JSON.stringify({
          file_key: (body.data as Record<string, unknown> | undefined)?.file_key || body.file_key,
        }),
      }),
    });
    return true;
  }

  async addReaction(messageId: string, emojiType: string): Promise<string | null> {
    try {
      const client = await this.getSdkClient();
      const messageReaction = (client.im as Record<string, unknown>)?.messageReaction as Record<string, unknown> | undefined;
      const create = messageReaction?.create as
        | ((args: {
            path: { message_id: string };
            data: { reaction_type: { emoji_type: string } };
          }) => Promise<Record<string, unknown>>)
        | undefined;
      if (!create) return null;
      const response = await create({
        path: { message_id: messageId },
        data: {
          reaction_type: {
            emoji_type: emojiType,
          },
        },
      });
      return String(((response.data as Record<string, unknown> | undefined)?.reaction_id || '') || '') || null;
    } catch (error) {
      this.logger.debug('feishu.reaction.add_failed', {
        messageId,
        emojiType,
        error: String((error as Error)?.message || error),
      });
      return null;
    }
  }

  async removeReaction(messageId: string, reactionId: string): Promise<boolean> {
    if (!reactionId) return false;
    try {
      const client = await this.getSdkClient();
      const messageReaction = (client.im as Record<string, unknown>)?.messageReaction as Record<string, unknown> | undefined;
      const remove = messageReaction?.delete as
        | ((args: {
            path: { message_id: string; reaction_id: string };
          }) => Promise<Record<string, unknown>>)
        | undefined;
      if (!remove) return false;
      await remove({
        path: {
          message_id: messageId,
          reaction_id: reactionId,
        },
      });
      return true;
    } catch (error) {
      this.logger.debug('feishu.reaction.remove_failed', {
        messageId,
        reactionId,
        error: String((error as Error)?.message || error),
      });
      return false;
    }
  }

  async sendCardKitMessage(
    chatId: string,
    card: FeishuCardKit,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null> {
    const cardId = await this.createCardKitEntity(card);
    const endpoint = options?.replyToMessageId
      ? `/open-apis/im/v1/messages/${options.replyToMessageId}/reply`
      : '/open-apis/im/v1/messages?receive_id_type=chat_id';
    const payload = await this.api(endpoint, {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(
        options?.replyToMessageId
          ? {
              msg_type: 'interactive',
              content: JSON.stringify({
                type: 'card',
                data: { card_id: cardId },
              }),
              reply_in_thread: options.replyInThread,
            }
          : {
              receive_id: chatId,
              msg_type: 'interactive',
              content: JSON.stringify({
                type: 'card',
                data: { card_id: cardId },
              }),
            },
      ),
    });
    const messageId = String(((payload.data as Record<string, unknown> | undefined)?.message_id || '') || '');
    if (!messageId) return null;
    const ref = this.encodeCardKitRef(messageId, cardId);
    this.cardKitSequences.set(ref, 1);
    this.cardKitUpdateQueues.set(ref, Promise.resolve());
    return ref;
  }

  private async startWebsocket(onEnvelope: (envelope: IncomingEnvelope) => Promise<void>): Promise<void> {
    const lark = await importLarkSdk();
    const client = new lark.WSClient({
      appId: this.config.app_id,
      appSecret: this.config.app_secret,
      loggerLevel: lark.LoggerLevel.info,
    });
    this.wsClient = client;

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        await this.handleEventEnvelope(
          {
            header: { event_type: 'im.message.receive_v1' },
            event: data,
          },
          onEnvelope,
        );
      },
    });

    await client.start({ eventDispatcher: dispatcher });
    this.logger.info('feishu.websocket.started');
  }

  private async startCallbackServer(onEnvelope: (envelope: IncomingEnvelope) => Promise<void>): Promise<void> {
    if (this.httpServer) return;
    const port = parsePort(this.config.callback_url, this.config.port);

    this.httpServer = http.createServer((req, res) => {
      const requestPath = normalizeRequestPath(req.url);
      if (req.method === 'GET' && requestPath === LOCAL_FILE_VIEW_PATH) {
        void this.handleLocalFileRequest(req, res);
        return;
      }
      if (req.method === 'GET' && requestPath === LOCAL_DETAIL_VIEW_PATH) {
        void this.handleDetailRequest(req, res);
        return;
      }
      if (!isAcceptedCallbackPath(requestPath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', async () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          if (!verifyFeishuRequest({ rawBody, headers: req.headers, config: this.config })) {
            res.writeHead(401);
            res.end();
            return;
          }

          let body = safeJsonParse<Record<string, unknown>>(rawBody, {});
          const encrypted = typeof body.encrypt === 'string' ? body.encrypt : '';
          if (encrypted && this.config.encrypt_key) {
            body = safeJsonParse<Record<string, unknown>>(
              decryptEvent(encrypted, this.config.encrypt_key),
              {},
            );
          }

          if (body.type === 'url_verification') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ challenge: typeof body.challenge === 'string' ? body.challenge : '' }));
            return;
          }

          const header = body.header as Record<string, unknown> | undefined;
          if (header?.event_type === 'im.message.receive_v1') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0 }));
            await this.handleEventEnvelope(body, onEnvelope);
            return;
          }

          const eventObj = body.event as Record<string, unknown> | undefined;
          const actionObj = body.action as Record<string, unknown> | undefined;
          if (body.open_message_id || actionObj?.value || (eventObj?.action as Record<string, unknown> | undefined)?.value) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0 }));

            const eventAction = eventObj?.action as Record<string, unknown> | undefined;
            const actionValueRaw = actionObj?.value || eventAction?.value;
            const actionValue =
              typeof actionValueRaw === 'string'
                ? actionValueRaw
                : typeof (actionValueRaw as { action?: string } | undefined)?.action === 'string'
                  ? (actionValueRaw as { action: string }).action
                  : '';

            const context = body.context as Record<string, unknown> | undefined;
            const operator = body.operator as Record<string, unknown> | undefined;
            const eventOperator = eventObj?.operator as Record<string, unknown> | undefined;
            const chatId = String(body.open_chat_id || eventObj?.open_chat_id || context?.open_chat_id || '');
            const senderId = String(operator?.open_id || eventOperator?.open_id || '');
            const messageId = String(body.open_message_id || eventObj?.open_message_id || '');
            await onEnvelope({
              type: 'action',
              action: actionValue,
              chatId,
              senderId,
              messageId,
              chatType: 'unknown',
            });
            return;
          }

          res.writeHead(200);
          res.end('OK');
        } catch (error) {
          this.logger.error('feishu.webhook.error', String(error));
          res.writeHead(500);
          res.end('error');
        }
      });
    });

    await new Promise<void>(resolve => {
      this.httpServer?.listen(port, () => resolve());
    });
    this.logger.info('feishu.webhook.started', {
      port,
      accepted_paths: ['/', FEISHU_CALLBACK_PATH, LOCAL_FILE_VIEW_PATH, LOCAL_DETAIL_VIEW_PATH],
      callback_url: this.config.callback_url,
    });
  }

  private async handleLocalFileRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || LOCAL_FILE_VIEW_PATH, 'http://127.0.0.1');
      const rawFilePath = url.searchParams.get('path') || '';
      const line = url.searchParams.get('line') || '';
      if (!rawFilePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('missing path');
        return;
      }

      const resolvedPath = path.resolve(rawFilePath);
      if (!isPathWithinRoots(resolvedPath, this.allowedFileRoots)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }

      const extension = path.extname(resolvedPath).toLowerCase();
      const imageMime = IMAGE_MIME_BY_EXT[extension] || '';
      if (imageMime) {
        const buffer = await fs.readFile(resolvedPath);
        res.writeHead(200, {
          'Content-Type': imageMime,
          'Cache-Control': 'no-store',
          'Content-Length': String(buffer.byteLength),
        });
        res.end(buffer);
        return;
      }

      const content = await fs.readFile(resolvedPath, 'utf8');
      const isJson = extension === '.json';
      const isMarkdown = extension === '.md';
      const title = `${path.basename(resolvedPath)}${line ? `:${line}` : ''}`;
      const highlightLine = Number(line);
      const normalizedHighlightLine = Number.isFinite(highlightLine) && highlightLine > 0 ? highlightLine : null;
      let preview = `<div class="text-preview">${renderCodeBlock(content)}</div>`;
      let badge = 'Text';

      if (isMarkdown) {
        badge = 'Markdown';
        preview = await marked.parse(content, {
          renderer: createMarkedRenderer({
            callbackUrl: this.config.callback_url,
            currentFilePath: resolvedPath,
          }),
        });
      } else if (isJson) {
        badge = 'JSON';
        try {
          const parsed = JSON.parse(content);
          preview = renderCodeBlock(JSON.stringify(parsed, null, 2), 'json');
        } catch {
          preview = renderCodeBlock(content, 'json');
        }
      }

      const html = buildPreviewHtml({
        title,
        badge,
        meta: resolvedPath,
        preview,
        source: buildSourceTable(content, normalizedHighlightLine),
        rawContent: content,
        line: normalizedHighlightLine ? String(normalizedHighlightLine) : '',
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (error) {
      this.logger.warn('feishu.local_file_view_failed', {
        error: String((error as Error)?.message || error),
      });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('file not found');
    }
  }

  private async handleDetailRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || LOCAL_DETAIL_VIEW_PATH, 'http://127.0.0.1');
      const ref = url.searchParams.get('ref') || '';
      const cached = ref ? loadDetailPayload(ref) : null;
      const title = cached?.title || url.searchParams.get('title') || 'Detail';
      const kind = cached?.kind || url.searchParams.get('kind') || 'detail';
      const content = cached?.content || decodeBase64Url(url.searchParams.get('content') || '');
      if (!content) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(ref ? 'detail expired, regenerate from chat card' : 'missing content');
        return;
      }

      const html = buildPreviewHtml({
        title,
        badge: kind,
        meta: `${title} · switch to Source for copyable raw text`,
        preview: buildDetailPreview({ content, kind }),
        source: buildSourceTable(content),
        rawContent: content,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (error) {
      this.logger.warn('feishu.detail_view_failed', {
        error: String((error as Error)?.message || error),
      });
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('invalid detail');
    }
  }

  private async handleEventEnvelope(
    body: Record<string, unknown>,
    onEnvelope: (envelope: IncomingEnvelope) => Promise<void>,
  ): Promise<void> {
    const event = (body.event || body) as Record<string, unknown>;
    const message = (event.message || {}) as Record<string, unknown>;
    const sender = event.sender as Record<string, unknown> | undefined;
    const senderIdObj = sender?.sender_id as Record<string, unknown> | undefined;
    const senderId = String(senderIdObj?.open_id || (event.sender_id as Record<string, unknown> | undefined)?.open_id || '');
    const chatId = String(message.chat_id || '');
    const messageId = String(message.message_id || crypto.randomUUID());
    const messageType = String(message.message_type || message.msg_type || 'text');
    const chatTypeRaw = String(message.chat_type || event.chat_type || '');
    const chatType = chatTypeRaw === 'p2p' ? 'p2p' : chatTypeRaw ? 'group' : 'unknown';

    if (processedMessageIds.has(messageId)) return;
    processedMessageIds.add(messageId);
    if (processedMessageIds.size > 2000) {
      const first = processedMessageIds.values().next().value;
      if (first) processedMessageIds.delete(first);
    }

    if (messageType === 'text') {
      await onEnvelope({
        type: 'message',
        chatId,
        senderId,
        messageId,
        text: asTextMessage(message.content),
        chatType,
      });
      return;
    }

    const filePayload =
      message.content && typeof message.content === 'object'
        ? (message.content as Record<string, unknown>)
        : safeJsonParse<Record<string, unknown>>(String(message.content || ''), {});
    const fileKey = String(filePayload.file_key || filePayload.image_key || '');
    if (!fileKey) return;

    const fileName = normalizeFileName(
      messageId,
      String(filePayload.file_name || filePayload.image_name || 'file'),
    );
    const token = await this.getTenantToken();
    const resourceType = messageType === 'image' ? 'image' : 'file';
    const resourceResponse = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${resourceType}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!resourceResponse.ok) {
      throw new Error(`Failed to download Feishu resource: ${resourceResponse.status}`);
    }

    const arrayBuffer = await resourceResponse.arrayBuffer();
    const localPath = path.join(this.filesDir, fileName);
    await fs.writeFile(localPath, Buffer.from(arrayBuffer));

    await onEnvelope({
      type: 'message',
      chatId,
      senderId,
      messageId,
      text: '',
      chatType,
      attachments: [
        {
          localPath,
          filename: fileName,
          mimeType: String(resourceResponse.headers.get('content-type') || ''),
          kind: messageType === 'image' ? 'image' : 'file',
        },
      ],
    });
  }
}
