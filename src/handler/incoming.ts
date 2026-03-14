import path from 'node:path';
import type { CodexUserInput, IncomingAttachment, IncomingEnvelope } from '../types.js';
import { createTextInput } from '../utils.js';

function isImageAttachment(attachment: IncomingAttachment): boolean {
  return attachment.kind === 'image';
}

export function toCodexInputs(envelope: Extract<IncomingEnvelope, { type: 'message' }>): CodexUserInput[] {
  const inputs: CodexUserInput[] = [];

  if (envelope.text?.trim()) {
    inputs.push(createTextInput(envelope.text.trim()));
  }

  for (const attachment of envelope.attachments || []) {
    if (isImageAttachment(attachment)) {
      inputs.push({ type: 'localImage', path: attachment.localPath });
      continue;
    }
    inputs.push(
      createTextInput(
        [
          'A file was uploaded by the user.',
          `Path: ${attachment.localPath}`,
          `Filename: ${attachment.filename || path.basename(attachment.localPath)}`,
          `Mime: ${attachment.mimeType || 'application/octet-stream'}`,
        ].join('\n'),
      ),
    );
  }

  return inputs;
}
