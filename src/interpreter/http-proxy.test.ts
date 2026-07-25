import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from './http.js';
import { ProxyPool } from './proxy.js';
import type { RateLimiter, RateLimitInfo } from '../auth/types.js';

/** Records which key each rate-limiter call was made against. */
function recordingRateLimiter(): RateLimiter & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async waitForCapacity(source: string) {
      keys.push(source);
    },
    recordResponse(_source: string, _info: RateLimitInfo) {},
    configure() {},
    getStatus: () => ({ limited: false }) as never,
    onEvent() {},
  } as unknown as RateLimiter & { keys: string[] };
}

describe('HttpClient egress proxies', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const pool = (urls: string[]) =>
    new ProxyPool(urls, { agentFactory: async (url) => ({ agentFor: url }) });

  it('dispatches the request through the pool proxy', async () => {
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      proxyPool: pool(['http://a:3128']),
    });
    let captured: unknown;

    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = (init as { dispatcher?: unknown } | undefined)?.dispatcher;
      return new Response('{}', { status: 200 });
    });

    await client.request({ method: 'GET', path: '/users' });

    expect(captured).toEqual({ agentFor: 'http://a:3128' });
  });

  it('sends no dispatcher when the source has no proxy', async () => {
    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    let init: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      init = options;
      return new Response('{}', { status: 200 });
    });

    await client.request({ method: 'GET', path: '/users' });

    expect(init).not.toHaveProperty('dispatcher');
  });

  it('gives each proxy its own rate-limit budget', async () => {
    const rateLimiter = recordingRateLimiter();
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      sourceName: 'FPL',
      rateLimiter,
      proxyPool: pool(['http://a:3128', 'http://b:3128']),
    });

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }));

    await client.request({ method: 'GET', path: '/users' });
    await client.request({ method: 'GET', path: '/users' });

    expect(rateLimiter.keys).toEqual(['FPL@a:3128', 'FPL@b:3128']);
  });

  it('keys on the source alone when unproxied, keeping existing behaviour', async () => {
    const rateLimiter = recordingRateLimiter();
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      sourceName: 'FPL',
      rateLimiter,
    });

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    await client.request({ method: 'GET', path: '/users' });

    expect(rateLimiter.keys).toEqual(['FPL']);
  });

  it('retries a 429 from a different proxy', async () => {
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      proxyPool: pool(['http://a:3128', 'http://b:3128']),
    });
    const dispatchers: unknown[] = [];

    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      dispatchers.push((init as { dispatcher?: unknown } | undefined)?.dispatcher);
      return dispatchers.length === 1
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '0' } })
        : new Response('{}', { status: 200 });
    });

    await client.request(
      { method: 'GET', path: '/users' },
      { maxAttempts: 2, backoff: 'constant', initialDelay: 0 }
    );

    expect(dispatchers).toEqual([{ agentFor: 'http://a:3128' }, { agentFor: 'http://b:3128' }]);
  });

  it('surfaces a proxy that cannot be dialled rather than falling back to direct egress', async () => {
    const broken = new ProxyPool(['http://a:3128'], {
      agentFactory: async () => {
        throw new Error('undici missing');
      },
    });
    const client = new HttpClient({ baseUrl: 'https://api.example.com', proxyPool: broken });

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }));

    await expect(client.request({ method: 'GET', path: '/users' })).rejects.toThrow(
      /undici missing/
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
