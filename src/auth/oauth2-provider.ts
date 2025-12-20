import type { AuthProvider, TokenInfo, TokenStore, OAuth2Tokens, OAuth2Config } from './types.js';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * OAuth2 auth provider with automatic token refresh
 */
export class OAuth2AuthProvider implements AuthProvider {
  private connectionId: string;
  private store: TokenStore;
  private config: OAuth2Config;
  private refreshBuffer: number;
  private refreshPromise: Promise<string> | null = null;

  constructor(options: {
    connectionId: string;
    store: TokenStore;
    config: OAuth2Config;
  }) {
    this.connectionId = options.connectionId;
    this.store = options.store;
    this.config = options.config;
    this.refreshBuffer = (options.config.refreshBuffer ?? 300) * 1000; // Convert to ms
  }

  async getToken(): Promise<string> {
    const tokens = await this.store.get(this.connectionId);

    if (!tokens) {
      throw new Error(`No tokens found for connection: ${this.connectionId}`);
    }

    // Check if we need to refresh
    if (this.shouldRefresh(tokens)) {
      return this.refreshToken();
    }

    // Update last used time
    await this.store.touch(this.connectionId);

    return tokens.accessToken;
  }

  async refreshToken(): Promise<string> {
    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<string> {
    const tokens = await this.store.get(this.connectionId);

    if (!tokens?.refreshToken) {
      throw new Error(`No refresh token available for connection: ${this.connectionId}`);
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${error}`);
    }

    const data = (await response.json()) as TokenResponse;

    const newTokens: OAuth2Tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken, // Keep old if not rotated
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
    };

    // Calculate expiry
    if (data.expires_in) {
      newTokens.expiresAt = new Date(Date.now() + data.expires_in * 1000);
    }

    await this.store.set(this.connectionId, newTokens);
    await this.store.touch(this.connectionId);

    return newTokens.accessToken;
  }

  private shouldRefresh(tokens: OAuth2Tokens): boolean {
    if (!tokens.expiresAt) {
      return false; // No expiry info, assume valid
    }

    const now = Date.now();
    const expiresAt = tokens.expiresAt.getTime();

    // Refresh if within buffer of expiry
    return expiresAt - now < this.refreshBuffer;
  }

  getTokenInfo(): TokenInfo {
    // Synchronous - returns cached info
    return {
      connectionId: this.connectionId,
    };
  }
}

/**
 * Simple bearer token provider (no refresh)
 */
export class BearerTokenProvider implements AuthProvider {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async getToken(): Promise<string> {
    return this.token;
  }

  getTokenInfo(): TokenInfo {
    return {};
  }
}

/**
 * API key provider
 */
export class ApiKeyProvider implements AuthProvider {
  private apiKey: string;
  private headerName: string;

  constructor(apiKey: string, headerName = 'X-API-Key') {
    this.apiKey = apiKey;
    this.headerName = headerName;
  }

  async getToken(): Promise<string> {
    return this.apiKey;
  }

  getHeaderName(): string {
    return this.headerName;
  }

  getTokenInfo(): TokenInfo {
    return {};
  }
}
