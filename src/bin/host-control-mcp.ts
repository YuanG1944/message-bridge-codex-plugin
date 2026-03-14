#!/usr/bin/env node
import fs from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RuntimeConfigForHostControl } from '../types.js';
import { createHostControlProvider } from '../host-control/index.js';
import { createHostControlMcpServer } from '../host-control/mcp.server.js';

function loadRuntimeConfig(): RuntimeConfigForHostControl {
  const filePath = process.env.BRIDGE_HOST_CONTROL_CONFIG || '';
  if (!filePath || !fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RuntimeConfigForHostControl;
}

async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const provider = createHostControlProvider({
    enabled: true,
    provider: 'auto',
    allowed_tools: runtimeConfig.allowed_tools || [],
    danger_tools: runtimeConfig.danger_tools || [],
  });

  const server = createHostControlMcpServer({
    provider,
    policyConfig: {
      allowed_tools: runtimeConfig.allowed_tools,
      danger_tools: runtimeConfig.danger_tools,
      enableDangerTools: Boolean(runtimeConfig.enable_danger_tools),
    },
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  process.stderr.write(`${String(error.stack || error)}\n`);
  process.exitCode = 1;
});
