import { describe, expect, test } from 'bun:test';
import { HostControlPolicy } from '../src/host-control/policy.js';

describe('HostControlPolicy', () => {
  test('exposes safe tools and hides danger tools by default', () => {
    const policy = new HostControlPolicy();

    expect(policy.isToolEnabled('host.get_status')).toBe(true);
    expect(policy.isToolEnabled('host.shutdown')).toBe(false);
    expect(policy.visibleTools()).toContain('host.get_status');
    expect(policy.visibleTools()).not.toContain('host.shutdown');
  });

  test('can enable danger tools explicitly', () => {
    const policy = new HostControlPolicy({
      enableDangerTools: true,
    });

    expect(policy.isToolEnabled('host.shutdown')).toBe(true);
    expect(policy.visibleTools()).toContain('host.shutdown');
  });

  test('throws when a disabled tool is requested', () => {
    const policy = new HostControlPolicy();
    expect(() => policy.assertAllowed('host.shutdown')).toThrow(
      'Tool host.shutdown is disabled by host-control policy.',
    );
  });
});
