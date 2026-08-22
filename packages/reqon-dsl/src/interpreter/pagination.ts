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
 * Locate the records array in a paginated response.
 *
 * When `itemsPath` is declared we resolve exactly that path and never guess -
 * a declared path that resolves to a non-array yields an empty page rather than
 * silently locking onto some other array-valued key.
 *
 * Without `itemsPath` we fall back to the first array-valued key, which is a
 * guess: on a `{warnings: [], data: [...]}` envelope it picks `warnings`,
 * reports zero records, and stops (#250). The guess is kept for convenience but
 * warns loudly (once per key) so a wrong pick is visible instead of silent.
 */
function findItemsArray(
  data: Record<string, unknown>,
  cacheKey: string,
  cache: ArrayFieldCache,
  itemsPath?: string
): unknown[] | undefined {
  // Declared path: resolve it and trust it, no fallback guessing.
  if (itemsPath) {
    const value = extractNestedValue(data, itemsPath);
    return Array.isArray(value) ? (value as unknown[]) : undefined;
  }

  // Check cache first
  const cachedField = cache.get(cacheKey);
  if (cachedField !== undefined) {
    if (cachedField === null) {
      return undefined;
    }
    const items = data[cachedField];
    if (Array.isArray(items)) {
      return items as unknown[];
    }
    // Cached field no longer valid, clear it
    cache.clear();
  }

  // Search for array field
  const pick = pickItemsField(data);
  if (pick !== undefined) {
    cache.set(cacheKey, pick);
    warnGuessedItemsField(pick, cacheKey);
    return data[pick] as unknown[];
  }

  // Cache negative result
  cache.set(cacheKey, null);
  return undefined;
}

/** Field names APIs conventionally hold their records in, preferred when guessing. */
const LIKELY_ITEM_FIELDS = new Set(['data', 'items', 'results', 'records', 'entries', 'rows']);

/**
 * Choose which array-valued key most plausibly holds the records: a
 * conventional record field with content, then any non-empty array, then a
 * conventional field even when empty, then the first array. A bare
 * "first array key wins" guess locks onto the empty `errors` of an
 * `{errors: [], data: [...]}` envelope and reports a clean zero-record run
 * (#250); preferring content and convention picks `data`.
 */
function pickItemsField(data: Record<string, unknown>): string | undefined {
  const arrayKeys = Object.keys(data).filter((key) => Array.isArray(data[key]));
  return (
    arrayKeys.find(
      (key) => LIKELY_ITEM_FIELDS.has(key.toLowerCase()) && (data[key] as unknown[]).length > 0
    ) ??
    arrayKeys.find((key) => (data[key] as unknown[]).length > 0) ??
    arrayKeys.find((key) => LIKELY_ITEM_FIELDS.has(key.toLowerCase())) ??
    arrayKeys[0]
  );
}

/** Fields we've already warned about, so the guess is reported once, not per page. */
const warnedGuessKeys = new Set<string>();

function warnGuessedItemsField(field: string, cacheKey: string): void {
  const marker = `${cacheKey}:${field}`;
  if (warnedGuessKeys.has(marker)) return;
  warnedGuessKeys.add(marker);
  console.warn(
    `[reqon] pagination guessed records live in the "${field}" field of the response; ` +
      `set itemsPath to declare this explicitly and avoid a wrong guess on envelopes ` +
      `like {warnings: [], data: [...]}.`
  );
}

/**
 * Extract items array from response and determine if more pages exist
 * Shared utility for offset and page-based pagination strategies
 */
function extractItemsFromResponse(
  response: unknown,
  pageSize: number,
  cacheKey: string,
  cache: ArrayFieldCache,
  itemsPath?: string
): { items: unknown[]; hasMore: boolean } {
  if (!response || typeof response !== 'object') {
    return { items: [], hasMore: false };
  }

  const data = response as Record<string, unknown>;
  const items = findItemsArray(data, cacheKey, cache, itemsPath);
  if (!items) {
    return { items: [], hasMore: false };
  }
  return { items, hasMore: items.length >= pageSize };
}

/**
 * @deprecated Use strategy.clearCache() instead. Kept for backward compatibility.
 * Note: This now only clears the global compatibility cache, not instance caches.
 */
export function clearPaginationCache(): void {
  // Item-array caches are instance-level (strategies call clearCache()); the
  // once-per-key guess-warning dedupe is module state, so reset it here.
  warnedGuessKeys.clear();
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
    return extractItemsFromResponse(
      response,
      ctx.pageSize,
      this.cacheKey,
      this.cache,
      this.config.itemsPath
    );
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
    return extractItemsFromResponse(
      response,
      ctx.pageSize,
      this.cacheKey,
      this.cache,
      this.config.itemsPath
    );
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

  extractResults(response: unknown, _ctx: PaginationContext): PageResult {
    if (!response || typeof response !== 'object') {
      return { items: [], hasMore: false };
    }

    const data = response as Record<string, unknown>;

    // Extract items. A declared itemsPath is resolved exactly and never guessed.
    let items: unknown[] = [];
    if (this.config.itemsPath) {
      const value = extractNestedValue(data, this.config.itemsPath);
      items = Array.isArray(value) ? (value as unknown[]) : [];
    } else if (this.cachedArrayField !== null && Array.isArray(data[this.cachedArrayField])) {
      items = data[this.cachedArrayField] as unknown[];
    } else {
      const pick = pickItemsField(data);
      if (pick !== undefined) {
        items = data[pick] as unknown[];
        this.cachedArrayField = pick;
        warnGuessedItemsField(pick, `cursor:${this.config.param}`);
      }
    }

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
  // A non-positive page size makes every page request the same offset and makes
  // the `items.length >= pageSize` termination test always true, so pagination
  // re-fetches page one until it hits the page cap. Reject it up front.
  if (!Number.isFinite(config.pageSize) || config.pageSize < 1) {
    throw new Error(`Pagination page size must be a positive integer, got ${config.pageSize}`);
  }
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
