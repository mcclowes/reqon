import type { TokenStore, OAuth2Tokens } from './types.js';

interface StoredToken extends OAuth2Tokens {
  lastUsedAt?: Date;
}

/**
 * In-memory token store - useful for development and single-process deployments
 */
export class InMemoryTokenStore implements TokenStore {
  private tokens: Map<string, StoredToken> = new Map();

  async get(connectionId: string): Promise<OAuth2Tokens | null> {
    const stored = this.tokens.get(connectionId);
    if (!stored) return null;

    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      refreshExpiresAt: stored.refreshExpiresAt,
      tokenType: stored.tokenType,
      scope: stored.scope,
    };
  }

  async set(connectionId: string, tokens: OAuth2Tokens): Promise<void> {
    const existing = this.tokens.get(connectionId);
    this.tokens.set(connectionId, {
      ...tokens,
      lastUsedAt: existing?.lastUsedAt ?? new Date(),
    });
  }

  async delete(connectionId: string): Promise<void> {
    this.tokens.delete(connectionId);
  }

  async touch(connectionId: string): Promise<void> {
    const stored = this.tokens.get(connectionId);
    if (stored) {
      stored.lastUsedAt = new Date();
    }
  }

  async list(): Promise<string[]> {
    return Array.from(this.tokens.keys());
  }

  /** Get tokens that need proactive refresh (approaching expiry or non-use expiry) */
  async getTokensNeedingRefresh(bufferSeconds = 300): Promise<string[]> {
    const now = new Date();
    const buffer = bufferSeconds * 1000;
    const needsRefresh: string[] = [];

    for (const [connectionId, stored] of this.tokens) {
      // Check access token expiry
      if (stored.expiresAt) {
        const expiresIn = stored.expiresAt.getTime() - now.getTime();
        if (expiresIn < buffer) {
          needsRefresh.push(connectionId);
          continue;
        }
      }

      // Check refresh token expiry from non-use
      if (stored.refreshExpiresAt && stored.lastUsedAt) {
        const refreshExpiresIn = stored.refreshExpiresAt.getTime() - now.getTime();
        if (refreshExpiresIn < buffer) {
          needsRefresh.push(connectionId);
        }
      }
    }

    return needsRefresh;
  }
}

/**
 * File-based token store - persists tokens to a JSON file
 * Suitable for CLI tools and single-user scenarios
 */
export class FileTokenStore implements TokenStore {
  private filePath: string;
  private cache: Map<string, StoredToken> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<Map<string, StoredToken>> {
    if (this.cache) return this.cache;

    try {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, StoredToken>;

      // Revive dates
      const map = new Map<string, StoredToken>();
      for (const [key, value] of Object.entries(data)) {
        map.set(key, {
          ...value,
          expiresAt: value.expiresAt ? new Date(value.expiresAt) : undefined,
          refreshExpiresAt: value.refreshExpiresAt ? new Date(value.refreshExpiresAt) : undefined,
          lastUsedAt: value.lastUsedAt ? new Date(value.lastUsedAt) : undefined,
        });
      }

      this.cache = map;
      return map;
    } catch {
      this.cache = new Map();
      return this.cache;
    }
  }

  private async save(): Promise<void> {
    if (!this.cache) return;

    const fs = await import('node:fs/promises');
    const data: Record<string, StoredToken> = {};

    for (const [key, value] of this.cache) {
      data[key] = value;
    }

    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async get(connectionId: string): Promise<OAuth2Tokens | null> {
    const map = await this.load();
    const stored = map.get(connectionId);
    if (!stored) return null;

    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      refreshExpiresAt: stored.refreshExpiresAt,
      tokenType: stored.tokenType,
      scope: stored.scope,
    };
  }

  async set(connectionId: string, tokens: OAuth2Tokens): Promise<void> {
    const map = await this.load();
    const existing = map.get(connectionId);

    map.set(connectionId, {
      ...tokens,
      lastUsedAt: existing?.lastUsedAt ?? new Date(),
    });

    await this.save();
  }

  async delete(connectionId: string): Promise<void> {
    const map = await this.load();
    map.delete(connectionId);
    await this.save();
  }

  async touch(connectionId: string): Promise<void> {
    const map = await this.load();
    const stored = map.get(connectionId);
    if (stored) {
      stored.lastUsedAt = new Date();
      await this.save();
    }
  }

  async list(): Promise<string[]> {
    const map = await this.load();
    return Array.from(map.keys());
  }
}
