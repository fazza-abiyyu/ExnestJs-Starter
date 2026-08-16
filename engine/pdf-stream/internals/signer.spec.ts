import { describe, expect, test } from 'bun:test';
import { TokenSigner } from './signer.js';

function signer() {
  return new TokenSigner('test-secret', 300);
}

describe('TokenSigner', () => {
  test('signs and verifies a resource token', () => {
    const s = signer();
    const { exp, sig } = s.sign('pdf:doc-a:1');
    expect(s.verify('pdf:doc-a:1', exp, sig)).toBe(true);
  });

  test('rejects a wrong resource', () => {
    const s = signer();
    const { exp, sig } = s.sign('pdf:doc-a:1');
    expect(s.verify('pdf:doc-a:2', exp, sig)).toBe(false);
  });

  test('rejects a tampered signature', () => {
    const s = signer();
    const { exp, sig } = s.sign('pdf:doc-a:1');
    expect(s.verify('pdf:doc-a:1', exp, sig + 'ff')).toBe(false);
    expect(s.verify('pdf:doc-a:1', exp, sig.slice(0, -2))).toBe(false);
  });

  test('rejects an expired token', () => {
    const s = signer();
    const { sig } = s.sign('pdf:doc-a:1', -10);
    const exp = Math.floor(Date.now() / 1000) - 10;
    expect(s.verify('pdf:doc-a:1', exp, sig)).toBe(false);
  });

  test('rejects malformed input', () => {
    const s = signer();
    expect(s.verify('pdf:doc-a:1', NaN, 'abc')).toBe(false);
    expect(s.verify('pdf:doc-a:1', 0, '')).toBe(false);
  });

  test('querySignature carries exp + sig', () => {
    const s = signer();
    const q = s.querySignature('pdf:doc-a:1');
    expect(q).toMatch(/^exp=\d+&sig=/);
  });
});
