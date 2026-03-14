import type { BridgeAdapter, FeishuAdapterCtor, FeishuCard, FeishuCardKit, IncomingEnvelope } from '../types.js';
import { FeishuRenderer } from './feishu.renderer.js';
import { FeishuClient } from './feishu.client.js';

export class FeishuAdapter implements BridgeAdapter {
  private readonly client: FeishuClient;
  private readonly renderer: FeishuRenderer;

  constructor(input: FeishuAdapterCtor) {
    this.client = new FeishuClient(input);
    this.renderer = new FeishuRenderer({
      callbackUrl: input.config.callback_url,
    });
  }

  async start(onEnvelope: (envelope: IncomingEnvelope) => Promise<void>): Promise<void> {
    await this.client.start(onEnvelope);
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async sendMessage(
    chatId: string,
    markdown: string,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null> {
    return this.client.sendMessage(chatId, JSON.stringify(this.renderer.renderCardKit(markdown)), options);
  }

  async editMessage(chatId: string, messageId: string, markdown: string): Promise<boolean> {
    return this.client.editMessage(chatId, messageId, JSON.stringify(this.renderer.renderCardKit(markdown)));
  }

  async addReaction(messageId: string, emojiType: string): Promise<string | null> {
    return this.client.addReaction(messageId, emojiType);
  }

  async removeReaction(messageId: string, reactionId: string): Promise<boolean> {
    return this.client.removeReaction(messageId, reactionId);
  }

  async sendLocalFile(chatId: string, localPath: string): Promise<boolean> {
    return this.client.sendFile(chatId, localPath);
  }

  async sendCard(
    chatId: string,
    card: FeishuCard | FeishuCardKit,
    options?: { replyToMessageId?: string; replyInThread?: boolean },
  ): Promise<string | null> {
    return this.client.sendCard(chatId, card, options);
  }
}
