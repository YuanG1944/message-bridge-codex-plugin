import { describe, expect, test } from 'bun:test';
import { FeishuRenderer } from '../src/feishu/feishu.renderer.js';

describe('FeishuRenderer', () => {
  test('renders remote-console sections into a structured card', () => {
    const renderer = new FeishuRenderer();
    const rendered = renderer.render(
      [
        '## Status',
        'Running on host',
        '',
        '## Thinking',
        'Inspecting workspace',
        '',
        '## Commands',
        '$ git status',
        'clean',
        '',
        '## Answer',
        'Completed {{ safely }}',
      ].join('\n'),
    );

    const card = JSON.parse(rendered) as Record<string, unknown>;
    const elements = card.elements as Array<Record<string, unknown>>;
    const firstElement = elements[0] as Record<string, unknown>;

    expect(card.header).toBeUndefined();
    expect(elements.length).toBeGreaterThan(0);
    expect(String(firstElement.content || '')).toContain('Completed { { safely } }');
    expect(JSON.stringify(card)).toContain('🧰 Tool Chain');
    expect(JSON.stringify(card)).toContain('🧭 Status');
    expect(JSON.stringify(card)).toContain('git status');
    expect(JSON.stringify(card)).toContain('💭 Thought');
  });

  test('shows a visible thinking state before answer text arrives', () => {
    const renderer = new FeishuRenderer();
    const rendered = renderer.render(
      [
        '## Status',
        '思考中...',
        '',
        '## Thinking',
        'Inspecting project structure',
      ].join('\n'),
    );

    expect(rendered).not.toContain('Thinking...');
    expect(rendered).toContain('🧰 Tool Chain');
    expect(rendered).toContain('🧭 Status');
    expect(rendered).toContain('💭 Thought');
    expect(rendered).toContain('Inspecting project structure');
  });

  test('renders a CardKit 2.0 payload for primary chat replies', () => {
    const renderer = new FeishuRenderer({
      callbackUrl: 'https://example.trycloudflare.com',
    });
    const card = renderer.renderCardKit(
      [
        '## Status',
        '正在回答...',
        '',
        '## Answer',
        'Hello from Codex',
      ].join('\n'),
    );

    expect(card.schema).toBe('2.0');
    expect(card.config?.streaming_mode).toBe(true);
    expect(Array.isArray(card.body.elements)).toBe(true);
    expect(String((card.config?.summary as { content?: string } | undefined)?.content || '')).toContain('Hello from Codex');
    expect(JSON.stringify(card)).toContain('Hello from Codex');
    expect(JSON.stringify(card)).toContain('查看正文');
    expect(JSON.stringify(card)).toContain('/bridge/detail?title=Answer');
  });

  test('rewrites local file links to callback viewer urls', () => {
    const renderer = new FeishuRenderer({
      callbackUrl: 'https://example.trycloudflare.com',
    });
    const rendered = renderer.render(
      [
        '## Answer',
        '[README.md](/home/yuan/repo/message-bridge-codex-plugin/README.md)',
      ].join('\n'),
    );

    expect(rendered).toContain('https://example.trycloudflare.com/bridge/file?path=%2Fhome%2Fyuan%2Frepo%2Fmessage-bridge-codex-plugin%2FREADME.md');
  });

  test('rewrites bare local file paths to callback viewer urls', () => {
    const renderer = new FeishuRenderer({
      callbackUrl: 'https://example.trycloudflare.com',
    });
    const rendered = renderer.render(
      [
        '## Answer',
        '/home/yuan/repo/message-bridge-codex-plugin/package.json:12',
      ].join('\n'),
    );

    expect(rendered).toContain('[\\/home\\/yuan\\/repo\\/message-bridge-codex-plugin\\/package.json:12]'.replace(/\\/g, ''));
    expect(rendered).toContain('https://example.trycloudflare.com/bridge/file?path=%2Fhome%2Fyuan%2Frepo%2Fmessage-bridge-codex-plugin%2Fpackage.json&line=12');
  });

  test('groups tool, command, and file sections into one activity panel with internal categories', () => {
    const renderer = new FeishuRenderer();
    const rendered = renderer.render(
      [
        '## Answer',
        'done',
        '',
        '## Tools',
        '🔄 search · running',
        '✅ search · completed',
        '',
        '## Commands',
        '$ pwd',
        '/tmp/demo',
        '$ ls',
        'README.md',
        '',
        '## Files',
        '- README.md',
        '- package.json',
      ].join('\n'),
    );

    const card = JSON.parse(rendered) as Record<string, unknown>;
    const elements = card.elements as Array<Record<string, unknown>>;
    const activity = elements.find(element => String(element.tag || '') === 'collapsible_panel') as Record<string, unknown>;
    const nested = Array.isArray(activity?.elements) ? (activity.elements as Array<Record<string, unknown>>) : [];

    expect(rendered).toContain('🧰 Tool Chain');
    expect(JSON.stringify(nested)).toContain('⚙️ Tool Activity #1');
    expect(JSON.stringify(nested)).toContain('⚙️ Tool Activity #2');
    expect(JSON.stringify(nested)).toContain('🖥 Command #1');
    expect(JSON.stringify(nested)).toContain('🖥 Command #2');
    expect(JSON.stringify(nested)).toContain('📁 File Change #1');
    expect(JSON.stringify(nested)).toContain('📁 File Change #2');
  });
});
