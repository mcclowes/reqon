import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HttpClient,
  BearerAuthProvider,
  OAuth2AuthProvider,
  BasicAuthProvider,
  ApiKeyAuthProvider,
  parseRetryAfterMs,
} from './http.js';
import { CircuitBreaker, CircuitBreakerError } from '../auth/circuit-breaker.js';

describe('parseRetryAfterMs', () => {
  const MAX = 60_000;
  it('parses delta-seconds and clamps to max', () => {
    expect(parseRetryAfterMs('30', MAX)).toBe(30_000);
    expect(parseRetryAfterMs('999999', MAX)).toBe(MAX); // clamped, no multi-hour sleep
  });
  it('returns undefined (not NaN) for an HTTP-date in the past and unparseable input', () => {
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', MAX)).toBe(0); // past date → 0
    expect(parseRetryAfterMs('not-a-number', MAX)).toBeUndefined();
    expect(parseRetryAfterMs(null, MAX)).toBeUndefined();
  });
});

describe('HttpClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('buildUrl', () => {
    it('constructs URL with base and path', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let capturedUrl = '';

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedUrl).toBe('https://api.example.com/users');
    });

    it('handles trailing slash on base URL', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com/' });
      let capturedUrl = '';

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedUrl).toBe('https://api.example.com/users');
    });

    it('handles path without leading slash', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let capturedUrl = '';

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: 'users' });

      expect(capturedUrl).toBe('https://api.example.com/users');
    });

    it('adds query parameters to URL', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let capturedUrl = '';

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({
        method: 'GET',
        path: '/users',
        query: { page: '1', limit: '10' },
      });

      expect(capturedUrl).toBe('https://api.example.com/users?page=1&limit=10');
    });
  });

  describe('timeout', () => {
    it('aborts a hung request after the configured timeout', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      globalThis.fetch = vi.fn((_url: RequestInfo | URL, opts?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const promise = client.request(
        { method: 'GET', path: '/slow' },
        { maxAttempts: 1, backoff: 'constant', initialDelay: 1, timeout: 5000 }
      );
      const expectation = expect(promise).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(5000);
      await expectation;
    });

    it('does not abort a request that responds before the timeout', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const res = await client.request(
        { method: 'GET', path: '/fast' },
        { maxAttempts: 1, backoff: 'constant', initialDelay: 1, timeout: 5000 }
      );
      expect(res.status).toBe(200);
    });
  });

  describe('headers', () => {
    it('sets default Content-Type and Accept headers', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['Accept']).toBe('application/json');
    });

    it('merges config headers', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        headers: { 'X-Custom': 'value' },
      });
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedHeaders['X-Custom']).toBe('value');
    });

    it('request headers override config headers', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        headers: { 'X-Custom': 'config' },
      });
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({
        method: 'GET',
        path: '/users',
        headers: { 'X-Custom': 'request' },
      });

      expect(capturedHeaders['X-Custom']).toBe('request');
    });

    it('adds Authorization header when auth provider is set', async () => {
      const auth = new BearerAuthProvider('test-token');
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        auth,
      });
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
    });

    it('sends HTTP Basic auth from a BasicAuthProvider (#200)', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        auth: new BasicAuthProvider('alice', 's3cret'),
      });
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      const expected = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`;
      expect(capturedHeaders['Authorization']).toBe(expected);
    });

    it('sends an API key in a header from an ApiKeyAuthProvider (#200)', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        auth: new ApiKeyAuthProvider('key-123'),
      });
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedHeaders['X-API-Key']).toBe('key-123');
    });

    it('sends an API key in a query param when configured (#200)', async () => {
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        auth: new ApiKeyAuthProvider('key-123', { name: 'apikey', location: 'query' }),
      });
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers || {}));
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users', query: { page: '1' } });

      expect(capturedUrl).toContain('apikey=key-123');
      expect(capturedUrl).toContain('page=1');
      // A query-param key must not also leak into an Authorization header.
      expect(capturedHeaders['Authorization']).toBeUndefined();
    });
  });

  describe('calculateDelay', () => {
    it('calculates exponential backoff delay', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const requestPromise = client.request(
        { method: 'GET', path: '/users' },
        { maxAttempts: 3, backoff: 'exponential', initialDelay: 1000 }
      );

      // First retry delay: ~1000ms (1000 * 2^0) + up to 10% jitter
      // Second retry delay: ~2000ms (1000 * 2^1) + up to 10% jitter
      // Advance enough time for both retries with jitter buffer
      await vi.advanceTimersByTimeAsync(4000);

      await requestPromise;

      expect(callCount).toBe(3);
    });

    it('calculates linear backoff delay', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const requestPromise = client.request(
        { method: 'GET', path: '/users' },
        { maxAttempts: 3, backoff: 'linear', initialDelay: 1000 }
      );

      // Advance through all retries with buffer for jitter
      await vi.advanceTimersByTimeAsync(5000);

      await requestPromise;

      expect(callCount).toBe(3);
    });

    it('calculates constant backoff delay', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const requestPromise = client.request(
        { method: 'GET', path: '/users' },
        { maxAttempts: 3, backoff: 'constant', initialDelay: 1000 }
      );

      // Both retries should use ~1000ms
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1100);

      await requestPromise;

      expect(callCount).toBe(3);
    });
  });

  describe('retry behavior', () => {
    it('retries on 5xx server errors', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 2) {
          return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
        }
        return new Response(JSON.stringify({ data: 'success' }), { status: 200 });
      });

      const requestPromise = client.request(
        { method: 'GET', path: '/users' },
        { maxAttempts: 3, backoff: 'constant', initialDelay: 100 }
      );

      await vi.advanceTimersByTimeAsync(150);
      const result = await requestPromise;

      expect(callCount).toBe(2);
      expect(result.status).toBe(200);
    });

    it('respects Retry-After header on 429', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 2) {
          const headers = new Headers();
          headers.set('Retry-After', '5'); // 5 seconds
          return new Response(JSON.stringify({}), { status: 429, headers });
        }
        return new Response(JSON.stringify({ data: 'success' }), { status: 200 });
      });

      const requestPromise = client.request(
        { method: 'GET', path: '/users' },
        { maxAttempts: 3, backoff: 'constant', initialDelay: 100 }
      );

      // Should wait 5 seconds as specified in Retry-After
      await vi.advanceTimersByTimeAsync(5000);
      const result = await requestPromise;

      expect(callCount).toBe(2);
      expect(result.status).toBe(200);
    });

    it('throws after max retry attempts', async () => {
      // Use real timers for this test to avoid unhandled rejection timing issues
      vi.useRealTimers();

      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      globalThis.fetch = vi.fn(async () => {
        throw new Error('Network error');
      });

      await expect(
        client.request(
          { method: 'GET', path: '/users' },
          { maxAttempts: 3, backoff: 'constant', initialDelay: 10 } // Short delay for fast test
        )
      ).rejects.toThrow('Network error');

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);

      // Restore fake timers for remaining tests
      vi.useFakeTimers();
    });

    it('cancels an abandoned response body on retry so sockets are not leaked (#253)', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      let callCount = 0;
      const cancelSpies: Array<ReturnType<typeof vi.fn>> = [];
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 2) {
          const res = new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
          const spy = vi.fn(async () => undefined);
          // The retry path must release the unread body rather than leaving it
          // for GC to reclaim the socket.
          if (res.body) res.body.cancel = spy;
          cancelSpies.push(spy);
          return res;
        }
        return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
      });

      const requestPromise = client.request(
        { method: 'GET', path: '/users' },
        { maxAttempts: 3, backoff: 'constant', initialDelay: 100 }
      );
      await vi.advanceTimersByTimeAsync(150);
      await requestPromise;

      expect(cancelSpies).toHaveLength(1);
      expect(cancelSpies[0]).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker integration (#254)', () => {
    it('reports 4xx failures to the breaker so a configured status can trip it', async () => {
      vi.useRealTimers();
      const breaker = new CircuitBreaker({
        failureStatusCodes: [403],
        failureThreshold: 3,
        failureWindow: 60_000,
      });
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        sourceName: 'api',
        circuitBreaker: breaker,
      });

      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
      );

      // A revoked key 403ing every request must accumulate toward the threshold.
      for (let i = 0; i < 3; i++) {
        await expect(
          client.request(
            { method: 'GET', path: '/users' },
            { maxAttempts: 1, backoff: 'constant', initialDelay: 1 }
          )
        ).rejects.toThrow(/HTTP 403/);
      }

      expect(breaker.getStatus('api').isOpen).toBe(true);

      // The next request is fast-failed by the open breaker instead of looping.
      await expect(
        client.request(
          { method: 'GET', path: '/users' },
          { maxAttempts: 1, backoff: 'constant', initialDelay: 1 }
        )
      ).rejects.toThrow(CircuitBreakerError);

      vi.useFakeTimers();
    });
  });

  describe('idempotency / non-idempotent retries', () => {
    it('does not retry a POST on 5xx (and surfaces it as an error)', async () => {
      vi.useRealTimers();
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'boom' }), { status: 503 });
      });

      // A non-idempotent POST is not retried on 5xx, and a non-2xx response is
      // an error rather than data (it must not be persisted as a record).
      await expect(
        client.request(
          { method: 'POST', path: '/payments', body: { amount: 100 } },
          { maxAttempts: 3, backoff: 'constant', initialDelay: 10 }
        )
      ).rejects.toThrow(/HTTP 503/);

      expect(callCount).toBe(1);
      vi.useFakeTimers();
    });

    it('does not retry a POST on a network error', async () => {
      vi.useRealTimers();
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      globalThis.fetch = vi.fn(async () => {
        throw new Error('socket hang up');
      });

      await expect(
        client.request(
          { method: 'POST', path: '/payments', body: { amount: 100 } },
          { maxAttempts: 3, backoff: 'constant', initialDelay: 10 }
        )
      ).rejects.toThrow('socket hang up');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      vi.useFakeTimers();
    });

    it('retries a POST that carries an idempotency key and sends the header', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let callCount = 0;
      let sentKey: string | null = null;
      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, opts?: RequestInit) => {
        callCount++;
        const headers = new Headers(opts?.headers);
        sentKey = headers.get('Idempotency-Key');
        if (callCount < 2) {
          return new Response(JSON.stringify({ error: 'boom' }), { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const promise = client.request(
        { method: 'POST', path: '/payments', body: { amount: 100 }, idempotencyKey: 'pay-123' },
        { maxAttempts: 3, backoff: 'constant', initialDelay: 100 }
      );
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(callCount).toBe(2);
      expect(result.status).toBe(200);
      expect(sentKey).toBe('pay-123');
    });

    it('still retries an idempotent PUT on 5xx', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 2) {
          return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const promise = client.request(
        { method: 'PUT', path: '/items/1', body: { name: 'x' } },
        { maxAttempts: 3, backoff: 'constant', initialDelay: 100 }
      );
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(callCount).toBe(2);
      expect(result.status).toBe(200);
    });
  });

  describe('response body release on retry paths (#253)', () => {
    /** A Response whose body reports whether it was ever read or cancelled. */
    function trackedResponse(status: number, headers?: Record<string, string>) {
      let released = false;
      const stream = new ReadableStream({
        cancel() {
          released = true;
        },
      });
      return { response: new Response(stream, { status, headers }), wasReleased: () => released };
    }

    it('releases the body of a 429 before retrying', async () => {
      const first = trackedResponse(429, { 'Retry-After': '1' });
      const responses = [first.response, new Response('{}', { status: 200 })];
      globalThis.fetch = vi.fn(async () => responses.shift()!);
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      const promise = client.request(
        { method: 'GET', path: '/x' },
        { maxAttempts: 2, backoff: 'constant', initialDelay: 10 }
      );
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(first.wasReleased()).toBe(true);
    });

    it('releases the body of a retried 5xx', async () => {
      const first = trackedResponse(500);
      const responses = [first.response, new Response('{}', { status: 200 })];
      globalThis.fetch = vi.fn(async () => responses.shift()!);
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      const promise = client.request(
        { method: 'GET', path: '/x' },
        { maxAttempts: 2, backoff: 'constant', initialDelay: 10 }
      );
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(first.wasReleased()).toBe(true);
    });

    it('releases the body of a 401 before retrying with a refreshed token', async () => {
      const first = trackedResponse(401);
      const responses = [first.response, new Response('{}', { status: 200 })];
      globalThis.fetch = vi.fn(async () => responses.shift()!);
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          getToken: async () => 'token',
          refreshToken: vi.fn(async () => 'fresh-token'),
        },
      });

      await client.request(
        { method: 'GET', path: '/x' },
        { maxAttempts: 2, backoff: 'constant', initialDelay: 1 }
      );

      expect(first.wasReleased()).toBe(true);
    });
  });

  describe('circuit breaker sees 4xx (#254)', () => {
    it('trips the breaker on repeated 403s instead of hammering forever', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: breaker,
        sourceName: 'api',
      });
      globalThis.fetch = vi.fn(async () => new Response('denied', { status: 403 }));

      for (let i = 0; i < 3; i++) {
        await expect(
          client.request(
            { method: 'GET', path: '/x' },
            { maxAttempts: 1, backoff: 'constant', initialDelay: 1 }
          )
        ).rejects.toThrow(/403/);
      }

      await expect(
        client.request(
          { method: 'GET', path: '/x' },
          { maxAttempts: 1, backoff: 'constant', initialDelay: 1 }
        )
      ).rejects.toThrow(/Circuit breaker open/);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('does not count data-shaped 4xx like 404 toward the threshold', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      const client = new HttpClient({
        baseUrl: 'https://api.example.com',
        circuitBreaker: breaker,
        sourceName: 'api',
      });
      globalThis.fetch = vi.fn(async () => new Response('missing', { status: 404 }));

      for (let i = 0; i < 5; i++) {
        await expect(
          client.request(
            { method: 'GET', path: '/x' },
            { maxAttempts: 1, backoff: 'constant', initialDelay: 1 }
          )
        ).rejects.toThrow(/404/);
      }

      // Still reaching the network: the breaker never opened.
      expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    });
  });

  describe('response handling', () => {
    it('parses JSON response body', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      const responseData = { id: 1, name: 'Test' };

      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(responseData), { status: 200 });
      });

      const result = await client.request<typeof responseData>({
        method: 'GET',
        path: '/users/1',
      });

      expect(result.data).toEqual(responseData);
    });

    it('returns response headers', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });

      globalThis.fetch = vi.fn(async () => {
        const headers = new Headers();
        headers.set('X-Total-Count', '100');
        return new Response(JSON.stringify({}), { status: 200, headers });
      });

      const result = await client.request({ method: 'GET', path: '/users' });

      expect(result.headers['x-total-count']).toBe('100');
    });

    it('sends request body as JSON', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let capturedBody: string | undefined;

      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({}), { status: 201 });
      });

      await client.request({
        method: 'POST',
        path: '/users',
        body: { name: 'Test', email: 'test@example.com' },
      });

      expect(capturedBody).toBe(JSON.stringify({ name: 'Test', email: 'test@example.com' }));
    });

    it('throws on a 4xx response instead of returning the error body as data', async () => {
      vi.useRealTimers();
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      });

      await expect(
        client.request(
          { method: 'GET', path: '/missing' },
          { maxAttempts: 3, backoff: 'constant', initialDelay: 1 }
        )
      ).rejects.toThrow(/HTTP 404/);
      // 4xx is definitive — not retried.
      expect(callCount).toBe(1);
      vi.useFakeTimers();
    });

    it('scrubs secrets echoed in an error body before they reach the error message (#263)', async () => {
      vi.useRealTimers();
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid grant', access_token: 'sk-live-ECHOED' }), {
            status: 400,
          })
      );

      try {
        await client.request(
          { method: 'GET', path: '/oauth' },
          { maxAttempts: 1, backoff: 'constant', initialDelay: 1 }
        );
        expect.unreachable('request should have thrown');
      } catch (error) {
        expect((error as Error).message).not.toContain('sk-live-ECHOED');
        expect((error as Error).message).toContain('invalid grant');
      } finally {
        vi.useFakeTimers();
      }
    });

    it('returns null for a 204 No Content response', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 }));

      const result = await client.request({ method: 'DELETE', path: '/users/1' });
      expect(result.status).toBe(204);
      expect(result.data).toBeNull();
    });

    it('returns null for an empty 200 body', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      globalThis.fetch = vi.fn(async () => new Response('', { status: 200 }));

      const result = await client.request({ method: 'GET', path: '/empty' });
      expect(result.data).toBeNull();
    });

    it('returns raw text for a non-JSON content type', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      globalThis.fetch = vi.fn(
        async () =>
          new Response('<html>ok</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
      );

      const result = await client.request<string>({ method: 'GET', path: '/page' });
      expect(result.data).toBe('<html>ok</html>');
    });
  });
});

describe('BearerAuthProvider', () => {
  it('returns the configured token', async () => {
    const provider = new BearerAuthProvider('my-token');
    const token = await provider.getToken();
    expect(token).toBe('my-token');
  });
});

describe('OAuth2AuthProvider', () => {
  it('returns the access token', async () => {
    const provider = new OAuth2AuthProvider({
      accessToken: 'access-token',
    });
    const token = await provider.getToken();
    expect(token).toBe('access-token');
  });

  it('throws when refreshToken called without required config', async () => {
    const provider = new OAuth2AuthProvider({
      accessToken: 'access-token',
    });

    await expect(provider.refreshToken()).rejects.toThrow(
      'Cannot refresh token: missing refresh token or endpoint'
    );
  });

  it('refreshes token using token endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const provider = new OAuth2AuthProvider({
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
        }),
        { status: 200 }
      );
    });

    const newToken = await provider.refreshToken();
    expect(newToken).toBe('new-token');

    // Token should be updated internally
    const currentToken = await provider.getToken();
    expect(currentToken).toBe('new-token');

    globalThis.fetch = originalFetch;
  });

  describe('refresh response validation (#255)', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    });

    const makeProvider = () =>
      new OAuth2AuthProvider({
        accessToken: 'old-token',
        refreshToken: 'refresh-1',
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      });

    it('throws the provider-supplied reason on a failed refresh, keeping the old token', async () => {
      const provider = makeProvider();
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }),
            { status: 400 }
          )
      );

      await expect(provider.refreshToken()).rejects.toThrow(/invalid_grant/);
      // The session must not be destroyed: "Bearer undefined" is worse than a 401.
      expect(await provider.getToken()).toBe('old-token');
    });

    it('throws when a 2xx refresh response carries no access_token', async () => {
      const provider = makeProvider();
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 })
      );

      await expect(provider.refreshToken()).rejects.toThrow(/access_token/);
      expect(await provider.getToken()).toBe('old-token');
    });

    it('refreshes proactively before an expires_in lifetime lapses', async () => {
      const provider = makeProvider();
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        return new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: 3600 }), {
          status: 200,
        });
      });

      await provider.refreshToken();
      expect(await provider.getToken()).toBe('token-1');

      // Past 80% of the 3600s lifetime the provider refreshes ahead of the 401.
      await vi.advanceTimersByTimeAsync(3000 * 1000);
      expect(await provider.getToken()).toBe('token-2');
      expect(calls).toBe(2);
    });
  });

  it('coalesces concurrent refreshes into a single network call (single-flight)', async () => {
    const originalFetch = globalThis.fetch;
    const provider = new OAuth2AuthProvider({
      accessToken: 'old-token',
      refreshToken: 'rotating-refresh-token',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    let callCount = 0;
    // Gate the in-flight refresh so all concurrent callers overlap on it
    // before any of them resolves.
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const fetchMock = vi.fn(async () => {
      callCount += 1;
      await fetchGate;
      return new Response(
        JSON.stringify({
          access_token: 'new-token',
          // Rotating refresh token: the old one is invalidated after first use
          refresh_token: `rotated-${callCount}`,
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock;

    // 10 concurrent callers all see the token as expired and trigger a refresh
    const pending = Promise.all(Array.from({ length: 10 }, () => provider.refreshToken()));

    // Let all callers reach the single in-flight refresh, then release it
    await Promise.resolve();
    releaseFetch();
    const results = await pending;

    // Exactly one network call to the token endpoint
    expect(callCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Every caller receives the same new access token
    for (const token of results) {
      expect(token).toBe('new-token');
    }

    // A subsequent refresh starts a fresh in-flight request
    const after = await provider.refreshToken();
    expect(after).toBe('new-token');
    expect(callCount).toBe(2);

    globalThis.fetch = originalFetch;
  });
});

describe('BasicAuthProvider (#200)', () => {
  it('base64-encodes username:password into a Basic header', async () => {
    const provider = new BasicAuthProvider('alice', 'p@ss:word');
    const contribution = await provider.applyAuth();
    const expected = Buffer.from('alice:p@ss:word').toString('base64');
    expect(contribution.headers?.['Authorization']).toBe(`Basic ${expected}`);
    expect(await provider.getToken()).toBe(expected);
  });
});

describe('ApiKeyAuthProvider (#200)', () => {
  it('defaults to the X-API-Key header', async () => {
    const provider = new ApiKeyAuthProvider('secret-key');
    const contribution = await provider.applyAuth();
    expect(contribution.headers).toEqual({ 'X-API-Key': 'secret-key' });
    expect(contribution.query).toBeUndefined();
  });

  it('uses a custom header name', async () => {
    const provider = new ApiKeyAuthProvider('secret-key', { name: 'Api-Token' });
    const contribution = await provider.applyAuth();
    expect(contribution.headers).toEqual({ 'Api-Token': 'secret-key' });
  });

  it('places the key in a query param when location is query', async () => {
    const provider = new ApiKeyAuthProvider('secret-key', { location: 'query' });
    const contribution = await provider.applyAuth();
    // Default query param name is api_key.
    expect(contribution.query).toEqual({ api_key: 'secret-key' });
    expect(contribution.headers).toBeUndefined();
  });
});
