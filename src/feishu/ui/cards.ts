import type { FeishuCard, FeishuCardKit } from '../../types.js';
import { sanitizeLarkMdForCard, sanitizeTemplateMarkers } from '../../utils.js';
import { optimizeMarkdownStyle } from './markdown-style.js';

function sanitizeCardValue<T>(value: T): T {
  if (typeof value === 'string') return sanitizeTemplateMarkers(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeCardValue(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeCardValue(child);
    }
    return out as T;
  }
  return value;
}

export function button(text: string, value: string, type: 'default' | 'primary' | 'danger' = 'default') {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type,
    value: { action: value },
  };
}

export function markdownCard(
  markdown: string,
  actions: Array<Record<string, unknown>> = [],
  options: { title?: string; template?: string } = {},
): FeishuCard {
  return sanitizeCardValue({
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: options.title || 'Codex Bridge',
      },
      ...(options.template ? { template: options.template } : {}),
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: sanitizeLarkMdForCard(markdown || ' '),
        },
      },
      ...(actions.length
        ? [
            {
              tag: 'action',
              actions,
            },
          ]
        : []),
    ],
  });
}

function commandMarkdown(content: string): Record<string, unknown> {
  return {
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: sanitizeLarkMdForCard(optimizeMarkdownStyle(content || ' ')),
    },
  };
}

function parseCommandLines(markdown: string): string[] {
  return String(markdown || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function cardKitMarkdown(content: string): Record<string, unknown> {
  return {
    tag: 'markdown',
    content: sanitizeLarkMdForCard(optimizeMarkdownStyle(content || ' ')),
  };
}

function renderHelpCommand(markdown: string): Array<Record<string, unknown>> | null {
  const lines = parseCommandLines(markdown);
  const helpIndex = lines.findIndex(line => /^###\s*help/i.test(line));
  if (helpIndex === -1) return null;

  const commandLines: string[] = [];
  for (let index = helpIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (/^###\s*/.test(line)) break;
    if (line.startsWith('/')) commandLines.push(line.replace(/^-+\s*/, ''));
  }

  if (commandLines.length === 0) return null;

  const groups: Array<{ title: string; match: RegExp; lines: string[] }> = [
    { title: 'Thread & Session', match: /^\/(?:help|new|threads|switch|fork|compact|interrupt|review)\b/i, lines: [] },
    { title: 'Workspace & Model', match: /^\/(?:model|plan|workspace|cwd|status)\b/i, lines: [] },
    { title: 'Actions & Approval', match: /^\/(?:actions|run|approve|deny|cancel)\b/i, lines: [] },
    { title: 'Files & Host', match: /^\/(?:sendfile|savefile|host)\b/i, lines: [] },
  ];

  for (const line of commandLines) {
    const target = groups.find(group => group.match.test(line));
    (target || groups[groups.length - 1])?.lines.push(line);
  }

  const elements: Array<Record<string, unknown>> = [
    cardKitMarkdown('**Help**\n使用这些命令来切换 thread、工作区、模型，以及控制主机。'),
  ];

  for (const group of groups) {
    if (!group.lines.length) continue;
    elements.push(
      cardKitMarkdown(
        `**${group.title}**\n${group.lines
          .map(line => {
            const [command, ...rest] = line.split(' - ');
            const desc = rest.join(' - ').trim();
            return `- \`${command}\`${desc ? `\n  ${desc}` : ''}`;
          })
          .join('\n')}`,
      ),
    );
  }

  return elements;
}

function renderModelsCommand(markdown: string): Array<Record<string, unknown>> | null {
  const lines = parseCommandLines(markdown);
  const titleIndex = lines.findIndex(line => /^###\s*models/i.test(line));
  if (titleIndex === -1) return null;

  const items = lines.slice(titleIndex + 1).filter(line => /^\d+\.\s+/.test(line));
  if (items.length === 0) return null;

  return [
    cardKitMarkdown('**Available Models**'),
    cardKitMarkdown(items.join('\n')),
  ];
}

function renderSimpleSectionCommand(markdown: string, expectedTitle: string, label: string): Array<Record<string, unknown>> | null {
  const lines = parseCommandLines(markdown);
  const titleIndex = lines.findIndex(line => new RegExp(`^###\\s*${expectedTitle}$`, 'i').test(line));
  if (titleIndex === -1) return null;

  const body = lines.slice(titleIndex + 1);
  if (body.length === 0) return null;

  return [
    cardKitMarkdown(`**${label}**`),
    cardKitMarkdown(body.join('\n')),
  ];
}

export function commandCard(markdown: string): FeishuCardKit {
  const text = String(markdown || '').trim();
  const isError =
    /^❌/.test(text) || /(^|\n)(error|failed|invalid|unknown|not found)\b/i.test(text);
  const title = isError ? '❌ Error' : '🧭 Command';
  const template = isError ? 'red' : 'green';
  const specialized =
    renderHelpCommand(text) ||
    renderModelsCommand(text) ||
    renderSimpleSectionCommand(text, 'Threads', 'Threads') ||
    renderSimpleSectionCommand(text, 'Workspaces', 'Workspaces') ||
    renderSimpleSectionCommand(text, 'Status', 'Status') ||
    renderSimpleSectionCommand(text, 'Actions', 'Actions') ||
    renderSimpleSectionCommand(text, 'Host Tools', 'Host Tools') ||
    renderSimpleSectionCommand(text, 'Host Status', 'Host Status');

  return sanitizeCardValue({
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      streaming_mode: false,
      update_multi: true,
      summary: { content: isError ? 'Error' : 'Command' },
    },
    header: {
      title: {
        tag: 'plain_text',
        content: title,
      },
      template,
    },
    body: {
      elements: specialized || [cardKitMarkdown(text || ' ')],
    },
  });
}
