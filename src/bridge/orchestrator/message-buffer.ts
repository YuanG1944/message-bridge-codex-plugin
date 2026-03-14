import { DEFAULT_STATUS_TEXT } from '../../constants/index.js';
import type { TurnBufferTarget } from '../../types.js';

function section(title: string, body: string): string {
  if (!body.trim()) return '';
  return `## ${title}\n${body.trim()}`;
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export class MessageBuffer {
  reasoning = '';
  answer = '';
  commandOutput = '';
  fileChanges = '';
  toolActivity = '';
  statusText = DEFAULT_STATUS_TEXT;
  approval = '';
  userInput = '';
  messageId: string | null = null;
  replyToMessageId: string | null = null;
  timer: NodeJS.Timeout | null = null;
  startedAt = Date.now();
  completedAt: number | null = null;

  append(target: TurnBufferTarget, delta: string): void {
    if (!delta) return;
    this[target] = `${this[target]}${delta}`;
  }

  finish(): void {
    this.completedAt = Date.now();
  }

  elapsedLabel(): string {
    const end = this.completedAt ?? Date.now();
    return formatElapsed(Math.max(0, end - this.startedAt));
  }

  markdown(): string {
    const parts = [
      section(
        'Status',
        this.completedAt ? `${this.statusText}\n耗时 ${this.elapsedLabel()}` : `${this.statusText}\n已运行 ${this.elapsedLabel()}`,
      ),
      section('Thinking', this.reasoning),
      section('Answer', this.answer),
      section('Commands', this.commandOutput),
      section('Files', this.fileChanges),
      section('Tools', this.toolActivity),
      section('Authorization', this.approval),
      section('Input Required', this.userInput),
    ].filter(Boolean);
    return parts.join('\n\n') || 'Working...';
  }
}
