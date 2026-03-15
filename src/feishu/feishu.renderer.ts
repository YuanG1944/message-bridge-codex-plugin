import type { FeishuCard, FeishuCardKit } from '../types.js';
import { sanitizeTemplateMarkers } from '../utils.js';
import { saveDetailPayload } from './detail-cache.js';
import { optimizeMarkdownStyle } from './ui/markdown-style.js';

type FeishuCardElement = Record<string, unknown>;
type ParsedSections = {
  status: string;
  thinking: string;
  answer: string;
  commands: string;
  files: string;
  tools: string;
  authorization: string;
  input: string;
};

const STREAMING_ELEMENT_ID = 'streaming_content';
const DETAIL_VIEW_PATH = '/bridge/detail';
const CARD_SECTION_LIMITS = {
  status: 400,
  thinking: 1600,
  answer: 3500,
  commands: 1200,
  files: 1200,
  tools: 1200,
  authorization: 600,
  input: 600,
} as const;

function trimSafe(value: string): string {
  return String(value || '').trim();
}

function buildLocalFileViewUrl(callbackUrl: string | null, filePath: string, line?: string): string {
  if (!callbackUrl) return filePath;
  const url = new URL('/bridge/file', callbackUrl);
  url.searchParams.set('path', filePath);
  if (line) url.searchParams.set('line', line);
  return url.toString();
}

function buildDetailViewUrl(
  callbackUrl: string | null,
  params: { title: string; content: string; kind: string },
): string {
  if (!callbackUrl) return '#';
  const ref = saveDetailPayload(params);
  const url = new URL(DETAIL_VIEW_PATH, callbackUrl);
  url.searchParams.set('ref', ref);
  return url.toString();
}

function rewriteLocalBarePaths(markdown: string, callbackUrl: string | null): string {
  if (!callbackUrl) return markdown;
  return markdown.replace(
    /(^|[\s>（(])((?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9._-]+(?::\d+)?)/gm,
    (full, prefix: string, rawPath: string) => {
      const lineMatch = rawPath.match(/^(.*?)(?::(\d+))?$/);
      const filePath = lineMatch?.[1] || rawPath;
      const line = lineMatch?.[2];
      const url = buildLocalFileViewUrl(callbackUrl, filePath, line);
      return `${prefix}[${rawPath}](${url})`;
    },
  );
}

function rewriteLocalMarkdownLinks(markdown: string, callbackUrl: string | null): string {
  if (!callbackUrl) return markdown;
  return markdown.replace(
    /\[([^\]]+)\]\((\/[^)\s]+?)(?::(\d+))?\)/g,
    (_full, label: string, filePath: string, line?: string) =>
      `[${label}](${buildLocalFileViewUrl(callbackUrl, filePath, line)})`,
  );
}

function sanitizeCardValue<T>(value: T): T {
  if (typeof value === 'string') return sanitizeTemplateMarkers(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeCardValue(item)) as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeCardValue(child);
    }
    return output as T;
  }
  return value;
}

function normalizeSectionTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/[*#:：]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchSectionKey(
  rawTitle: string,
): 'status' | 'thinking' | 'answer' | 'commands' | 'files' | 'tools' | 'authorization' | 'input' | null {
  const title = normalizeSectionTitle(rawTitle);
  if (!title) return null;
  if (['status', '状态'].includes(title)) return 'status';
  if (['thinking', 'thought', '思考'].includes(title)) return 'thinking';
  if (['answer', '回答'].includes(title)) return 'answer';
  if (['commands', 'command', '终端', '命令'].includes(title)) return 'commands';
  if (['files', 'file', '文件'].includes(title)) return 'files';
  if (['tools', 'tool', 'steps', 'step', '工具', '步骤'].includes(title)) return 'tools';
  if (['authorization', 'approval', '授权'].includes(title)) return 'authorization';
  if (['input required', 'input', '输入'].includes(title)) return 'input';
  return null;
}

function parseSections(markdown: string): ParsedSections {
  const sections: ParsedSections = {
    status: '',
    thinking: '',
    answer: '',
    commands: '',
    files: '',
    tools: '',
    authorization: '',
    input: '',
  };

  const headerRegex = /(?:^|\n)##\s*(.+?)(?=\n|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let currentKey: keyof ParsedSections = 'answer';

  while ((match = headerRegex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      sections[currentKey] += markdown.slice(lastIndex, match.index).trim();
    }
    currentKey = (matchSectionKey(match[1] || '') || 'answer') as keyof ParsedSections;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < markdown.length) {
    sections[currentKey] += markdown.slice(lastIndex).trim();
  }

  return sections;
}

function clampText(value: string, limit: number): string {
  const text = trimSafe(value);
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 24)).trimEnd()}\n\n...[truncated]`;
}

function clampSections(sections: ParsedSections): ParsedSections {
  return {
    status: clampText(sections.status, CARD_SECTION_LIMITS.status),
    thinking: clampText(sections.thinking, CARD_SECTION_LIMITS.thinking),
    answer: clampText(sections.answer, CARD_SECTION_LIMITS.answer),
    commands: clampText(sections.commands, CARD_SECTION_LIMITS.commands),
    files: clampText(sections.files, CARD_SECTION_LIMITS.files),
    tools: clampText(sections.tools, CARD_SECTION_LIMITS.tools),
    authorization: clampText(sections.authorization, CARD_SECTION_LIMITS.authorization),
    input: clampText(sections.input, CARD_SECTION_LIMITS.input),
  };
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function normalizeStatusText(status: string): string {
  const text = trimSafe(status).toLowerCase();
  if (!text) return '思考中...';
  if (text.includes('error') || text.includes('fail')) return '出错';
  if (text.includes('interrupt') || text.includes('cancel') || text.includes('abort')) return '已停止';
  if (text.includes('complete') || text.includes('done') || text.includes('success') || text.includes('idle')) {
    return '已完成';
  }
  if (text.includes('approval')) return '等待授权';
  if (text.includes('input')) return '等待输入';
  if (text.includes('command') || text.includes('tool') || text.includes('exec')) return '执行中';
  if (text.includes('answer') || text.includes('result')) return '正在整理结果';
  return '思考中...';
}

function isTerminalStatus(status: string): boolean {
  const text = trimSafe(status).toLowerCase();
  if (!text) return false;
  return (
    text.includes('complete') ||
    text.includes('done') ||
    text.includes('success') ||
    text.includes('idle') ||
    text.includes('error') ||
    text.includes('fail') ||
    text.includes('interrupt') ||
    text.includes('cancel') ||
    text.includes('abort')
  );
}

function reasoningDurationLabel(status: string): string {
  const elapsed = status.match(/(?:耗时|已运行)\s+([0-9.]+s|[0-9]+m\s+[0-9]+s)/);
  return elapsed?.[1] ? `Thought for ${elapsed[1]}` : 'Thought';
}

function buildFooter(text: string, isError?: boolean, detailUrl?: string | null): FeishuCardElement[] {
  const suffix = detailUrl ? ` | [查看正文](${detailUrl})` : '';
  const content = isError ? `<font color='red'>${text}</font>${suffix}` : `${text}${suffix}`;
  return [{ tag: 'markdown', content, text_size: 'notation' }];
}

function buildAnswerDetailUrl(answer: string, callbackUrl: string | null): string | null {
  const clean = trimSafe(answer);
  if (!clean || !callbackUrl) return null;
  return buildDetailViewUrl(callbackUrl, {
    title: 'Answer',
    content: clean,
    kind: 'answer',
  });
}

function buildCollapsiblePanel(
  title: string,
  contentOrElements: string | FeishuCardElement[],
  expanded = false,
): FeishuCardElement | null {
  const isString = typeof contentOrElements === 'string';
  const clean = isString ? trimSafe(contentOrElements) : '';
  const elements = isString
    ? clean
      ? [
          {
            tag: 'markdown',
            content: clean,
            text_size: 'notation',
          },
        ]
      : []
    : contentOrElements.filter(Boolean);
  if (!elements.length) return null;
  return {
    tag: 'collapsible_panel',
    expanded,
    header: {
      title: {
        tag: 'markdown',
        content: title,
      },
      vertical_align: 'center',
      icon: {
        tag: 'standard_icon',
        token: 'down-small-ccm_outlined',
        size: '16px 16px',
      },
      icon_position: 'follow_text',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements,
  };
}

function splitToolBlocks(raw: string): string[] {
  const clean = trimSafe(raw);
  if (!clean) return [];
  const lines = clean.split('\n').map(line => line.trimEnd());
  const blocks: string[] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      pushCurrent();
      continue;
    }
    if (/^[✅🔄•📝]/.test(line) && current.length > 0) {
      pushCurrent();
    }
    current.push(line);
  }
  pushCurrent();
  return blocks.length ? blocks : [clean];
}

function splitCommandBlocks(raw: string): string[] {
  const clean = trimSafe(raw);
  if (!clean) return [];
  const lines = clean.split('\n');
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (/^\$ /.test(line) || /^Command:/i.test(line) || /^> /.test(line)) starts.push(index);
  }
  if (!starts.length) return [clean];

  const blocks: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index] ?? 0;
    const end = index + 1 < starts.length ? (starts[index + 1] ?? lines.length) : lines.length;
    const block = lines.slice(start, end).join('\n').trim();
    if (block) blocks.push(block);
  }
  return blocks.length ? blocks : [clean];
}

function splitFileBlocks(raw: string): string[] {
  const clean = trimSafe(raw);
  if (!clean) return [];
  const lines = clean.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pushCurrent();
      continue;
    }
    if ((/^[\[\{]/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) && current.length > 0) {
      pushCurrent();
    }
    current.push(line);
  }
  pushCurrent();
  return blocks.length ? blocks : [clean];
}

function buildActivityPanels(sections: ParsedSections): FeishuCardElement[] {
  const panels: FeishuCardElement[] = [];
  const toolBlocks = splitToolBlocks(sections.tools);
  const commandBlocks = splitCommandBlocks(sections.commands);
  const fileBlocks = splitFileBlocks(sections.files);

  const status = trimSafe(sections.status);
  if (status) {
    const panel = buildCollapsiblePanel('🧭 Status', status, false);
    if (panel) panels.push(panel);
  }

  const thinking = trimSafe(sections.thinking);
  if (thinking) {
    const panel = buildCollapsiblePanel(`💭 ${reasoningDurationLabel(sections.status)}`, thinking, false);
    if (panel) panels.push(panel);
  }

  toolBlocks.forEach((block, index) => {
    const panel = buildCollapsiblePanel(
      toolBlocks.length > 1 ? `⚙️ Tool Activity #${index + 1}` : '⚙️ Tool Activity',
      block,
      false,
    );
    if (panel) panels.push(panel);
  });
  commandBlocks.forEach((block, index) => {
    const panel = buildCollapsiblePanel(
      commandBlocks.length > 1 ? `🖥 Command #${index + 1}` : '🖥 Commands',
      block,
      false,
    );
    if (panel) panels.push(panel);
  });
  fileBlocks.forEach((block, index) => {
    const panel = buildCollapsiblePanel(
      fileBlocks.length > 1 ? `📁 File Change #${index + 1}` : '📁 Files',
      block,
      false,
    );
    if (panel) panels.push(panel);
  });

  const authorization = trimSafe(sections.authorization);
  if (authorization) {
    const panel = buildCollapsiblePanel('🔐 Authorization', authorization, false);
    if (panel) panels.push(panel);
  }

  const input = trimSafe(sections.input);
  if (input) {
    const panel = buildCollapsiblePanel('⌨️ Input Required', input, false);
    if (panel) panels.push(panel);
  }

  return panels;
}

function buildAuxiliaryPanels(sections: ParsedSections): FeishuCardElement[] {
  const activityPanels = buildActivityPanels(sections);
  const panel = buildCollapsiblePanel('🧰 Tool Chain', activityPanels, false);
  return panel ? [panel] : [];
}

function buildSummaryText(answer: string): { content: string } | undefined {
  const summaryText = trimSafe(answer).replace(/[*_`#>\[\]()~]/g, '').trim();
  return summaryText ? { content: summaryText.slice(0, 120) } : undefined;
}

function buildThinkingCard(callbackUrl: string | null): FeishuCard {
  const sections: ParsedSections = {
    status: '思考中...',
    thinking: '',
    answer: '',
    commands: '',
    files: '',
    tools: '',
    authorization: '',
    input: '',
  };
  return {
    config: { wide_screen_mode: true, update_multi: true, summary: { content: '思考中...' } },
    elements: [
      {
        tag: 'markdown',
        content: ' ',
        element_id: STREAMING_ELEMENT_ID,
      },
      ...buildAuxiliaryPanels(sections),
    ].filter(Boolean) as FeishuCardElement[],
  };
}

function buildStreamingCard(sections: ParsedSections, callbackUrl: string | null): FeishuCard {
  const answer = trimSafe(sections.answer);
  const elements: FeishuCardElement[] = [];
  const answerDetailUrl = buildAnswerDetailUrl(answer, callbackUrl);

  if (answer) {
    elements.push({
      tag: 'markdown',
      content: optimizeMarkdownStyle(answer),
      element_id: STREAMING_ELEMENT_ID,
    });
  } else {
    elements.push({
      tag: 'markdown',
      content: ' ',
      element_id: STREAMING_ELEMENT_ID,
    });
  }

  elements.push(...buildAuxiliaryPanels(sections));

  const footerText = normalizeStatusText(sections.status);
  if (footerText) {
    elements.push(...buildFooter(footerText, false, answerDetailUrl));
  }

  return {
    config: { wide_screen_mode: true, update_multi: true, summary: buildSummaryText(answer || footerText) },
    elements,
  };
}

function buildCompleteCard(sections: ParsedSections, callbackUrl: string | null): FeishuCard {
  const answer = trimSafe(sections.answer) || ' ';
  const status = trimSafe(sections.status);
  const isError = /error|fail/i.test(status);
  const isAborted = /interrupt|cancel|abort/i.test(status);
  const elements: FeishuCardElement[] = [];
  const answerDetailUrl = buildAnswerDetailUrl(answer, callbackUrl);

  elements.push({
    tag: 'markdown',
    content: optimizeMarkdownStyle(answer),
  });

  elements.push(...buildAuxiliaryPanels(sections));

  const parts: string[] = [];
  const normalizedStatus = normalizeStatusText(status);
  if (normalizedStatus) parts.push(normalizedStatus);
  const elapsed = status.match(/(?:耗时|已运行)\s+([0-9.]+s|[0-9]+m\s+[0-9]+s)/);
  if (elapsed?.[1]) parts.push(`耗时 ${elapsed[1]}`);

  if (parts.length > 0) {
    elements.push(...buildFooter(parts.join(' · '), isError, answerDetailUrl));
  } else if (isAborted) {
    elements.push(...buildFooter('已停止', false, answerDetailUrl));
  }

  return {
    config: { wide_screen_mode: true, update_multi: true, summary: buildSummaryText(answer) },
    elements,
  };
}

function buildCard(markdown: string, callbackUrl: string | null): FeishuCard {
  const sections = clampSections(parseSections(markdown));
  const hasAnswer = Boolean(trimSafe(sections.answer));
  const hasStreamingData =
    Boolean(trimSafe(sections.thinking)) ||
    Boolean(trimSafe(sections.commands)) ||
    Boolean(trimSafe(sections.tools)) ||
    Boolean(trimSafe(sections.files)) ||
    hasAnswer;

  if (isTerminalStatus(sections.status)) {
    return buildCompleteCard(sections, callbackUrl);
  }
  if (hasStreamingData) {
    return buildStreamingCard(sections, callbackUrl);
  }
  return buildThinkingCard(callbackUrl);
}

function toCardKit2(card: FeishuCard): FeishuCardKit {
  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      update_multi: true,
      streaming_mode: true,
      ...(card.config || {}),
    },
    ...(card.header ? { header: sanitizeCardValue(card.header) } : {}),
    body: {
      elements: card.elements.map(element => sanitizeCardValue(element)),
    },
  };
}

export function renderFeishuCardFromHandlerMarkdown(markdown: string): string {
  return JSON.stringify(sanitizeCardValue(buildCard(markdown, null)));
}

export function renderCardKitFromHandlerMarkdown(markdown: string): FeishuCardKit {
  return sanitizeCardValue(toCardKit2(buildCard(markdown, null)));
}

export class FeishuRenderer {
  private readonly callbackUrl: string | null;

  constructor(input: { callbackUrl?: string } = {}) {
    this.callbackUrl = input.callbackUrl || null;
  }

  render(markdown: string): string {
    const rewritten = rewriteLocalBarePaths(rewriteLocalMarkdownLinks(markdown, this.callbackUrl), this.callbackUrl);
    return JSON.stringify(sanitizeCardValue(buildCard(rewritten, this.callbackUrl)));
  }

  renderCardKit(markdown: string): FeishuCardKit {
    const rewritten = rewriteLocalBarePaths(rewriteLocalMarkdownLinks(markdown, this.callbackUrl), this.callbackUrl);
    return sanitizeCardValue(toCardKit2(buildCard(rewritten, this.callbackUrl)));
  }
}
