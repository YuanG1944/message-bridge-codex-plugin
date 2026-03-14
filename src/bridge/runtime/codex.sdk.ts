import { Codex } from '@openai/codex-sdk';
import type { LoggerLike } from '../../types.js';

export class CodexSdkClient {
  private readonly sdk: Codex;
  private readonly logger: LoggerLike;

  constructor(input: { logger: LoggerLike }) {
    this.logger = input.logger;
    this.sdk = new Codex();
  }

  async runOnce(prompt: string, cwd: string): Promise<string> {
    const thread = this.sdk.startThread({
      workingDirectory: cwd,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    });
    const turn = await thread.run(prompt);
    this.logger.debug('codex.sdk.runOnce', { cwd, usage: turn.usage });
    return turn.finalResponse;
  }
}
