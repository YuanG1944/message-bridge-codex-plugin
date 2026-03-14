import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { APP_NAME } from '../constants/index.js';
import type { HostControlPolicyConfig, HostControlProvider } from '../types.js';
import { HostControlPolicy } from './policy.js';

function toolResult(result: unknown) {
  const structuredContent =
    result && typeof result === 'object'
      ? (result as Record<string, unknown>)
      : { value: result };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent,
  };
}

export function createHostControlMcpServer(input: {
  provider: HostControlProvider;
  policyConfig: HostControlPolicyConfig;
}): McpServer {
  const policy = new HostControlPolicy(input.policyConfig);
  const server = new McpServer({ name: `${APP_NAME}-host-control`, version: '0.1.0' });
  const provider = input.provider;

  if (policy.isToolEnabled('host.get_status')) {
    server.registerTool(
      'host.get_status',
      { description: 'Read host basics like hostname, cwd, uptime, and platform.' },
      async () => toolResult(await provider.getStatus()),
    );
  }

  if (policy.isToolEnabled('host.open_url')) {
    server.registerTool(
      'host.open_url',
      {
        description: 'Open a URL in the default browser.',
        inputSchema: z.object({ url: z.string().url() }),
      },
      async ({ url }) => toolResult(await provider.openUrl({ url })),
    );
  }

  if (policy.isToolEnabled('host.open_app')) {
    server.registerTool(
      'host.open_app',
      {
        description: 'Launch a desktop application or local command.',
        inputSchema: z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
        }),
      },
      async ({ command, args }) => toolResult(await provider.openApp({ command, args })),
    );
  }

  if (policy.isToolEnabled('host.capture_screen')) {
    server.registerTool(
      'host.capture_screen',
      { description: 'Capture the current desktop and return the saved image path.' },
      async () => toolResult(await provider.captureScreen()),
    );
  }

  if (policy.isToolEnabled('host.list_windows')) {
    server.registerTool(
      'host.list_windows',
      { description: 'List currently open desktop windows.' },
      async () => toolResult(await provider.listWindows()),
    );
  }

  if (policy.isToolEnabled('host.focus_window')) {
    server.registerTool(
      'host.focus_window',
      {
        description: 'Focus a desktop window by id.',
        inputSchema: z.object({ windowId: z.string() }),
      },
      async ({ windowId }) => toolResult(await provider.focusWindow({ windowId })),
    );
  }

  if (policy.isToolEnabled('host.read_clipboard')) {
    server.registerTool(
      'host.read_clipboard',
      { description: 'Read plain text from the clipboard.' },
      async () => toolResult(await provider.readClipboard()),
    );
  }

  if (policy.isToolEnabled('host.write_clipboard')) {
    server.registerTool(
      'host.write_clipboard',
      {
        description: 'Write plain text into the clipboard.',
        inputSchema: z.object({ text: z.string() }),
      },
      async ({ text }) => toolResult(await provider.writeClipboard({ text })),
    );
  }

  if (policy.isToolEnabled('host.notify')) {
    server.registerTool(
      'host.notify',
      {
        description: 'Show a desktop notification to the current user.',
        inputSchema: z.object({
          title: z.string(),
          body: z.string().optional(),
        }),
      },
      async ({ title, body }) => toolResult(await provider.notify({ title, body })),
    );
  }

  return server;
}
