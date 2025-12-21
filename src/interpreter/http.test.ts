import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, BearerAuthProvider, OAuth2AuthProvider } from './http.js';

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

  describe('headers', () => {
    it('sets default Content-Type and Accept headers', async () => {
      const client = new HttpClient({ baseUrl: 'https://api.example.com' });
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers || {})
        );
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
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers || {})
        );
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
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers || {})
        );
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
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers || {})
        );
        return new Response(JSON.stringify({}), { status: 200 });
      });

      await client.request({ method: 'GET', path: '/users' });

      expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
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
});
