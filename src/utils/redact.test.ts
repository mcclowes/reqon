import { describe, it, expect } from 'vitest';
import { redactSecrets, redactNamedValue, isSensitiveKey, REDACTED } from './redact.js';

describe('redactSecrets', () => {
  it('redacts credential-looking keys at any depth', () => {
    const input = {
      user: 'alice',
      apiKey: 'sk-123',
      nested: { accessToken: 'tok', refresh_token: 'r', keep: 1 },
      list: [{ password: 'p', name: 'ok' }],
    };

    const out = redactSecrets(input);

    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested.accessToken).toBe(REDACTED);
    expect(out.nested.refresh_token).toBe(REDACTED);
    expect(out.nested.keep).toBe(1);
    expect(out.list[0].password).toBe(REDACTED);
    expect(out.list[0].name).toBe('ok');
    expect(out.user).toBe('alice');
  });

  it('does not mutate the input', () => {
    const input = { token: 'secret' };
    redactSecrets(input);
    expect(input.token).toBe('secret');
  });

  it('passes through primitives unchanged', () => {
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBeNull();
  });

  it('handles cyclic objects without throwing', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });

  it('redacts a shared object reference reached by more than one path', () => {
    const creds = { token: 'sk-abc' };
    const out = redactSecrets({ a: creds, b: creds }) as {
      a: { token: string };
      b: { token: string };
    };
    // Both paths must resolve to redacted copies — the second visit must not
    // leak the original cleartext object.
    expect(out.a.token).toBe(REDACTED);
    expect(out.b.token).toBe(REDACTED);
    // The redacted copy is not the untouched input object.
    expect(out.b).not.toBe(creds);
    expect(creds.token).toBe('sk-abc'); // input still unmutated
  });

  it('passes Date values through unchanged instead of collapsing them to {} (#263)', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const out = redactSecrets({ when, token: 'sk-1' }) as { when: Date; token: string };
    expect(out.when).toBeInstanceOf(Date);
    expect(out.when.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(out.token).toBe(REDACTED);
  });

  it('passes other class instances (RegExp) through unchanged (#263)', () => {
    const out = redactSecrets({ pattern: /ab+c/i }) as { pattern: RegExp };
    expect(out.pattern).toBeInstanceOf(RegExp);
    expect(out.pattern.source).toBe('ab+c');
  });

  it('redacts secrets inside a cyclic object rather than leaking the original', () => {
    const a: Record<string, unknown> = { token: 'sk-cycle' };
    a.self = a;
    const out = redactSecrets(a) as Record<string, unknown>;
    expect(out.token).toBe(REDACTED);
    // The cycle resolves back to the redacted copy, not the raw input.
    expect(out.self).toBe(out);
    expect((out.self as Record<string, unknown>).token).toBe(REDACTED);
  });
});

describe('isSensitiveKey', () => {
  it('matches common credential names case-insensitively', () => {
    for (const k of ['password', 'API_KEY', 'authorization', 'clientSecret', 'Cookie']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });

  it('does not match ordinary names', () => {
    for (const k of ['userId', 'count', 'title', 'email']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('redactNamedValue', () => {
  it('hides the whole value when the name is sensitive', () => {
    expect(redactNamedValue('apiKey', 'sk-123')).toBe(REDACTED);
  });

  it('redacts nested secrets for an innocuous name', () => {
    const out = redactNamedValue('config', { host: 'h', token: 't' }) as Record<string, unknown>;
    expect(out.host).toBe('h');
    expect(out.token).toBe(REDACTED);
  });
});
