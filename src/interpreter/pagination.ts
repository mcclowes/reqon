import type { PaginationConfig } from '../ast/nodes.js';
import { extractNestedValue } from '../utils/path.js';

/**
 * Context for pagination operations
 */
export interface PaginationContext {
  page: number;
  cursor?: string;
  pageSize: number;
}

/**
 * Result from extracting page data
 */
export interface PageResult {
  items: unknown[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Strategy interface for different pagination types
 */
export interface PaginationStrategy {
  /** Build query parameters for the current page */
  buildQuery(ctx: PaginationContext): Record<string, string>;

  /** Extract results and determine if more pages exist */
  extractResults(response: unknown, ctx: PaginationContext): PageResult;

  /** Clear any cached state (for reuse across different responses) */
  clearCache?(): void;
}

/** Default TTL for cache entries (5 minutes) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of cache entries before cleanup */
const MAX_CACHE_ENTRIES = 100;

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

/**
 * Instance-level cache for array field discovery.
 * Each pagination strategy instance has its own cache to avoid global state pollution.
 */
class ArrayFieldCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(key: string): string | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: string | null): void {
    // Cleanup if cache is getting too large
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.cleanup();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    // If still too large, remove oldest half
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toRemove = entries.slice(0, Math.floor(entries.length / 2));
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Extract items array from response and determine if more pages exist
 * Shared utility for offset and page-based pagination strategies
 */
function extractItemsFromResponse(
  response: unknown,
  pageSize: number,
  cacheKey: string,
  cache: ArrayFieldCache
): { items: unknown[]; hasMore: boolean } {
  if (!response || typeof response !== 'object') {
    return { items: [], hasMore: false };
  }

  const data = response as Record<string, unknown>;

  // Check cache first
  const cachedField = cache.get(cacheKey);
  if (cachedField !== undefined) {
    if (cachedField === null) {
      return { items: [], hasMore: false };
    }
    const items = data[cachedField] as unknown[];
    if (Array.isArray(items)) {
      return {
        items,
        hasMore: items.length >= pageSize,
      };
    }
    // Cached field no longer valid, clear it
    cache.clear();
  }

  // Search for array field
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) {
      const items = data[key] as unknown[];
      cache.set(cacheKey, key);
      return {
        items,
        hasMore: items.length >= pageSize,
      };
    }
  }

  // Cache negative result
  cache.set(cacheKey, null);

  return { items: [], hasMore: false };
}

/**
 * @deprecated Use strategy.clearCache() instead. Kept for backward compatibility.
 * Note: This now only clears the global compatibility cache, not instance caches.
 */
export function clearPaginationCache(): void {
  // No-op - caches are now instance-level
  // Individual strategies should call clearCache() if needed
}

/**
 * Offset-based pagination (e.g., offset=100, offset=200)
 */
export class OffsetPaginationStrategy implements PaginationStrategy {
  private cacheKey: string;
  private cache: ArrayFieldCache;

  constructor(private config: PaginationConfig) {
    this.cacheKey = `offset:${config.param}`;
    this.cache = new ArrayFieldCache();
  }

  buildQuery(ctx: PaginationContext): Record<string, string> {
    return {
      [this.config.param]: String(ctx.page * ctx.pageSize),
    };
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    return extractItemsFromResponse(response, ctx.pageSize, this.cacheKey, this.cache);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Page number pagination (e.g., page=1, page=2)
 */
export class PageNumberPaginationStrategy implements PaginationStrategy {
  private cacheKey: string;
  private cache: ArrayFieldCache;

  constructor(private config: PaginationConfig) {
    this.cacheKey = `page:${config.param}`;
    this.cache = new ArrayFieldCache();
  }

  buildQuery(ctx: PaginationContext): Record<string, string> {
    return {
      [this.config.param]: String(ctx.page + 1), // 1-indexed
    };
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    return extractItemsFromResponse(response, ctx.pageSize, this.cacheKey, this.cache);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Cursor-based pagination (e.g., cursor=abc123)
 */
export class CursorPaginationStrategy implements PaginationStrategy {
  private cachedArrayField: string | null = null;

  constructor(private config: PaginationConfig) {}

  buildQuery(ctx: PaginationContext): Record<string, string> {
    if (ctx.cursor) {
      return { [this.config.param]: ctx.cursor };
    }
    return {};
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    if (!response || typeof response !== 'object') {
      return { items: [], hasMore: false };
    }

    const data = response as Record<string, unknown>;

    // Extract items - use cached field if available
    let items: unknown[] = [];
    if (this.cachedArrayField !== null && Array.isArray(data[this.cachedArrayField])) {
      items = data[this.cachedArrayField] as unknown[];
    } else {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          items = data[key] as unknown[];
          this.cachedArrayField = key;
          break;
        }
      }
    }

    // Extract next cursor
    let nextCursor: string | undefined;
    if (this.config.cursorPath) {
      const cursorValue = extractNestedValue(data, this.config.cursorPath);
      nextCursor = cursorValue ? String(cursorValue) : undefined;
    }

    return {
      items,
      hasMore: !!nextCursor,
      nextCursor,
    };
  }

  clearCache(): void {
    this.cachedArrayField = null;
  }
}

/**
 * Create the appropriate pagination strategy based on config
 */
export function createPaginationStrategy(config: PaginationConfig): PaginationStrategy {
  switch (config.type) {
    case 'offset':
      return new OffsetPaginationStrategy(config);
    case 'page':
      return new PageNumberPaginationStrategy(config);
    case 'cursor':
      return new CursorPaginationStrategy(config);
    default:
      throw new Error(`Unknown pagination type: ${(config as PaginationConfig).type}`);
  }
}
