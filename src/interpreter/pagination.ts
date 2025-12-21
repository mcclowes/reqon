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
}

/** Cache for discovered array field keys to avoid repeated lookups */
const arrayFieldCache: Map<string, string | null> = new Map();

/**
 * Extract items array from response and determine if more pages exist
 * Shared utility for offset and page-based pagination strategies
 * Caches the discovered array field for subsequent pages
 */
function extractItemsFromResponse(
  response: unknown,
  pageSize: number,
  cacheKey?: string
): { items: unknown[]; hasMore: boolean } {
  if (!response || typeof response !== 'object') {
    return { items: [], hasMore: false };
  }

  const data = response as Record<string, unknown>;

  // Check cache first if we have a cache key
  if (cacheKey) {
    const cachedField = arrayFieldCache.get(cacheKey);
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
    }
  }

  // Search for array field
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) {
      const items = data[key] as unknown[];
      // Cache the discovered field
      if (cacheKey) {
        arrayFieldCache.set(cacheKey, key);
      }
      return {
        items,
        hasMore: items.length >= pageSize,
      };
    }
  }

  // Cache negative result
  if (cacheKey) {
    arrayFieldCache.set(cacheKey, null);
  }

  return { items: [], hasMore: false };
}

/** Clear the array field cache (useful for testing) */
export function clearPaginationCache(): void {
  arrayFieldCache.clear();
}

/**
 * Offset-based pagination (e.g., offset=100, offset=200)
 */
export class OffsetPaginationStrategy implements PaginationStrategy {
  private cacheKey: string;

  constructor(private config: PaginationConfig) {
    this.cacheKey = `offset:${config.param}`;
  }

  buildQuery(ctx: PaginationContext): Record<string, string> {
    return {
      [this.config.param]: String(ctx.page * ctx.pageSize),
    };
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    return extractItemsFromResponse(response, ctx.pageSize, this.cacheKey);
  }
}

/**
 * Page number pagination (e.g., page=1, page=2)
 */
export class PageNumberPaginationStrategy implements PaginationStrategy {
  private cacheKey: string;

  constructor(private config: PaginationConfig) {
    this.cacheKey = `page:${config.param}`;
  }

  buildQuery(ctx: PaginationContext): Record<string, string> {
    return {
      [this.config.param]: String(ctx.page + 1), // 1-indexed
    };
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    return extractItemsFromResponse(response, ctx.pageSize, this.cacheKey);
  }
}

/**
 * Cursor-based pagination (e.g., cursor=abc123)
 */
export class CursorPaginationStrategy implements PaginationStrategy {
  private cacheKey: string;
  private cachedArrayField: string | null = null;

  constructor(private config: PaginationConfig) {
    this.cacheKey = `cursor:${config.param}`;
  }

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
