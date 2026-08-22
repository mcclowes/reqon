import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { safeEqual, hmacSha256Hex, verifyHmacSignature } from './crypto-safe.js';

describe('safeEqual', () => {
  it('is true for equal strings and false otherwise', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    expect(safeEqual('short', 'longer-string')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('hmacSha256Hex', () => {
  it('matches node crypto for the same secret and body', () => {
    const expected = createHmac('sha256', 'k').update('body', 'utf8').digest('hex');
    expect(hmacSha256Hex('k', 'body')).toBe(expected);
  });
});

describe('verifyHmacSignature', () => {
  const secret = 'shhh';
  const body = '{"a":1}';
  const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('accepts a correct bare hex signature', () => {
    expect(verifyHmacSignature(secret, body, sig)).toBe(true);
  });

  it('accepts a scheme-prefixed signature (sha256=...)', () => {
    expect(verifyHmacSignature(secret, body, `sha256=${sig}`)).toBe(true);
  });

  it('rejects a wrong signature, a tampered body, and an empty signature', () => {
    expect(verifyHmacSignature(secret, body, 'deadbeef')).toBe(false);
    expect(verifyHmacSignature(secret, '{"a":2}', sig)).toBe(false);
    expect(verifyHmacSignature(secret, body, '')).toBe(false);
  });
});
