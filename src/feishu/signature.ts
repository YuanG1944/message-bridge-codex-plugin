import crypto from 'node:crypto';
import type { FeishuConfig } from '../types.js';

export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function verifyTimestamp(timestamp: string, maxSkewMs = 5 * 60 * 1000): boolean {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  return Math.abs(Date.now() - value * 1000) <= maxSkewMs;
}

export function verifyFeishuRequest(input: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  config: FeishuConfig;
}): boolean {
  const body = safeJsonParse<Record<string, unknown>>(input.rawBody, {});

  if (input.config.verification_token) {
    const header = (body.header || {}) as Record<string, unknown>;
    const event = (body.event || {}) as Record<string, unknown>;
    const token = body.token || header.token || event.token || body.schema;
    if (token && token !== input.config.verification_token) return false;
  }

  if (input.config.signing_secret) {
    const timestampRaw =
      input.headers['x-lark-request-timestamp'] || input.headers['X-Lark-Request-Timestamp'];
    const signatureRaw = input.headers['x-lark-signature'] || input.headers['X-Lark-Signature'];
    const timestamp = Array.isArray(timestampRaw) ? timestampRaw[0] : timestampRaw;
    const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw;
    if (!timestamp || !signature || !verifyTimestamp(timestamp)) return false;

    const digest = crypto
      .createHmac('sha256', input.config.signing_secret)
      .update(`${timestamp}${input.rawBody}`)
      .digest('base64');
    if (digest !== signature) return false;
  }

  return true;
}
