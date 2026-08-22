import { describe, it, expect, afterEach, vi } from 'vitest';
import { OAuth2AuthProvider } from './oauth2-provider.js';
import { InMemoryTokenStore } from './token-store.js';
import type { OAuth2Config, OAuth2Tokens } from './types.js';

const CONFIG: OAuth2Config = {
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshBuffer: 300,
};

async function makeProvider(tokens: OAuth2Tokens) {
  const store = new InMemoryTokenStore();
  await store.set('conn-1', tokens);
  const provider = new OAuth2AuthProvider({
    connectionId: 'conn-1',
    store,
    config: CONFIG,
  });
  return { provider, store };
}

describe('OAuth2AuthProvider doRefresh', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const expiredTokens: OAuth2Tokens = {
    accessToken: 'old-access',
    refreshToken: 'refresh-1',
    // Already expired so getToken() triggers a refresh.
    expiresAt: new Date(Date.now() - 1000),
  };

  it('throws on a non-2xx refresh response instead of producing "Bearer undefined"', async () => {
    const { provider } = await makeProvider(expiredTokens);

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        statusText: 'Bad Request',
      });
    });

    await expect(provider.getToken()).rejects.toThrow(/Token refresh failed: 400/);

    // The error must NOT leak the response body (could echo client secret).
    await expect(provider.refreshToken()).rejects.not.toThrow(/invalid_grant/);
  });

  it('throws when a 2xx refresh response carries no access_token', async () => {
    const { provider } = await makeProvider(expiredTokens);

    globalThis.fetch = vi.fn(async () => {
      // Well-formed 200 but missing access_token.
      return new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 });
    });

    await expect(provider.refreshToken()).rejects.toThrow(/no access_token/);
  });

  it('refreshes successfully on a valid 2xx response', async () => {
    const { provider, store } = await makeProvider(expiredTokens);

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        }),
        { status: 200 }
      );
    });

    const token = await provider.getToken();
    expect(token).toBe('new-access');

    const stored = await store.get('conn-1');
    expect(stored?.accessToken).toBe('new-access');
    expect(stored?.refreshToken).toBe('refresh-2');
  });
});
