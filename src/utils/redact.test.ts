import { describe, it, expect } from 'vitest';
import { redactSecrets, redactNamedValue, redactText, isSensitiveKey, REDACTED } from './redact.js';

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

  it('redacts secrets inside a cyclic object rather than leaking the original', () => {
    const a: Record<string, unknown> = { token: 'sk-cycle' };
    a.self = a;
    const out = redactSecrets(a) as Record<string, unknown>;
    expect(out.token).toBe(REDACTED);
    // The cycle resolves back to the redacted copy, not the raw input.
    expect(out.self).toBe(out);
    expect((out.self as Record<string, unknown>).token).toBe(REDACTED);
  });

  it('passes Date values through intact instead of destroying them', () => {
    const when = new Date('2026-01-01T00:00:00Z');
    const out = redactSecrets({ when, apiKey: 'sk' });
    expect(out.when).toBe(when);
    expect(out.apiKey).toBe(REDACTED);
  });

  it('passes RegExp and binary values through intact', () => {
    const pattern = /abc/g;
    const buf = Buffer.from('bytes');
    const typed = new Uint8Array([1, 2, 3]);
    const out = redactSecrets({ pattern, buf, typed });
    expect(out.pattern).toBe(pattern);
    expect(out.buf).toBe(buf);
    expect(out.typed).toBe(typed);
  });

  it('redacts inside Map values and rebuilds Sets rather than flattening them to {}', () => {
    const map = new Map<string, unknown>([
      ['api_key', 'sk-live'],
      ['plain', { token: 't', keep: 1 }],
    ]);
    const set = new Set([{ password: 'p' }]);

    const out = redactSecrets({ map, set });

    expect(out.map).toBeInstanceOf(Map);
    expect(out.map.get('api_key')).toBe(REDACTED);
    expect((out.map.get('plain') as Record<string, unknown>).token).toBe(REDACTED);
    expect((out.map.get('plain') as Record<string, unknown>).keep).toBe(1);
    expect(out.set).toBeInstanceOf(Set);
    expect([...out.set][0]).toEqual({ password: REDACTED });
    // Inputs unmutated
    expect(map.get('api_key')).toBe('sk-live');
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

  it('matches jwt, signature, and segment-bounded otp/pin', () => {
    for (const k of [
      'jwt',
      'idJwt',
      'signature',
      'x_signature',
      'otp',
      'otpCode',
      'user_pin',
      'PIN',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });

  it('does not match words merely containing otp/pin, or session_count', () => {
    for (const k of ['spinner', 'shipping', 'laptop', 'session_count', 'sessionCount']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });

  it('still matches session itself and credential-bearing session keys', () => {
    for (const k of ['session', 'session_id', 'sessionToken']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
});

describe('redactText', () => {
  it('scrubs sensitive JSON pairs from a body snippet', () => {
    const body = '{"error": "bad request", "api_key": "sk-live-SECRET", "id": "42"}';
    const out = redactText(body);
    expect(out).not.toContain('sk-live-SECRET');
    expect(out).toContain('bad request');
    expect(out).toContain('"42"');
  });

  it('scrubs sensitive query params from URLs in messages', () => {
    const msg = 'GET https://api.example.com/v1/x?page=2&access_token=SECRET failed';
    const out = redactText(msg);
    expect(out).not.toContain('SECRET');
    expect(out).toContain('page=2');
  });

  it('scrubs bearer credentials', () => {
    const out = redactText('got header Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain(`Bearer ${REDACTED}`);
  });

  it('leaves innocuous text untouched', () => {
    const msg = 'HTTP 500 fetching /orders?page=2&limit=50: {"error": "server exploded"}';
    expect(redactText(msg)).toBe(msg);
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
