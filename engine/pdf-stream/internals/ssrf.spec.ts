import { describe, expect, test } from 'bun:test';
import { isPrivateAddress, SsrfGuard } from './ssrf.js';

describe('isPrivateAddress', () => {
  test('blocks IPv4 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.1.1')).toBe(true);
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('224.0.0.1')).toBe(true);
  });

  test('allows public IPv4', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
  });

  test('blocks IPv6 private ranges', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fc00::')).toBe(true);
    expect(isPrivateAddress('fe80::')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
  });

  test('rejects garbage', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('SsrfGuard', () => {
  const guard = new SsrfGuard({ blockPrivate: true });

  async function code(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
      return undefined;
    } catch (err) {
      return (err as { code?: string }).code;
    }
  }

  test('rejects non-http protocols', async () => {
    expect(await code(guard.assertSafeUrl('file:///etc/passwd'))).toBe('SSRF_BLOCKED');
  });

  test('rejects URLs with credentials', async () => {
    expect(await code(guard.assertSafeUrl('http://user:pass@evil.com/'))).toBe('SSRF_BLOCKED');
  });

  test('rejects unresolvable hosts', async () => {
    expect(await code(guard.assertSafeUrl('http://no-such-host.invalid/'))).toBe('DNS_FAILED');
  });
});
