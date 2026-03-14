import crypto from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { FeishuConfig } from '../src/types.js';
import { verifyFeishuRequest, verifyTimestamp } from '../src/feishu/signature.js';

const config: FeishuConfig = {
  app_id: 'app_id',
  app_secret: 'app_secret',
  mode: 'webhook',
  port: 18080,
  callback_url: 'http://127.0.0.1:18080',
  encrypt_key: '',
  verification_token: 'verify-token',
  signing_secret: 'signing-secret',
};

describe('verifyTimestamp', () => {
  test('accepts a fresh request timestamp', () => {
    expect(verifyTimestamp(String(Math.floor(Date.now() / 1000)))).toBe(true);
  });

  test('rejects stale timestamps', () => {
    expect(verifyTimestamp('1')).toBe(false);
  });
});

describe('verifyFeishuRequest', () => {
  test('accepts a valid signed webhook payload', () => {
    const rawBody = JSON.stringify({
      token: config.verification_token,
      event: { type: 'message' },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', config.signing_secret)
      .update(`${timestamp}${rawBody}`)
      .digest('base64');

    expect(
      verifyFeishuRequest({
        rawBody,
        headers: {
          'x-lark-request-timestamp': timestamp,
          'x-lark-signature': signature,
        },
        config,
      }),
    ).toBe(true);
  });

  test('rejects invalid token or signature', () => {
    const rawBody = JSON.stringify({
      token: 'wrong-token',
      event: { type: 'message' },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(
      verifyFeishuRequest({
        rawBody,
        headers: {
          'x-lark-request-timestamp': timestamp,
          'x-lark-signature': 'bad-signature',
        },
        config,
      }),
    ).toBe(false);
  });
});
