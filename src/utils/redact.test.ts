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
