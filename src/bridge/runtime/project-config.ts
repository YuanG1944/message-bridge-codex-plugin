import fs from 'node:fs/promises';
import path from 'node:path';

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export async function writeProjectCodexConfig(input: {
  repoRoot: string;
  hostControlConfigPath: string;
}): Promise<string> {
  const dotCodexDir = path.join(input.repoRoot, '.codex');
  const filePath = path.join(dotCodexDir, 'config.toml');

  const distScript = path.join(input.repoRoot, 'dist', 'src', 'bin', 'host-control-mcp.js');
  const sourceScript = path.join(input.repoRoot, 'src', 'bin', 'host-control-mcp.ts');
  const scriptPath = await fs
    .access(distScript)
    .then(() => distScript)
    .catch(() => sourceScript);
  const command =
    scriptPath.endsWith('.ts') && !process.versions.bun ? 'bun' : process.execPath;

  const content = [
    '[mcp_servers.host-control]',
    `command = ${tomlString(command)}`,
    `args = [${tomlString(scriptPath)}]`,
    '',
    '[mcp_servers.host-control.env]',
    `BRIDGE_HOST_CONTROL_CONFIG = ${tomlString(input.hostControlConfigPath)}`,
    '',
  ].join('\n');

  await fs.mkdir(dotCodexDir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}
