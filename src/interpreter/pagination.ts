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

/**
 * Offset-based pagination (e.g., offset=100, offset=200)
 */
export class OffsetPaginationStrategy implements PaginationStrategy {
  constructor(private config: PaginationConfig) {}

  buildQuery(ctx: PaginationContext): Record<string, string> {
    return {
      [this.config.param]: String(ctx.page * ctx.pageSize),
    };
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    const { items, hasMore } = this.extractItems(response, ctx.pageSize);
    return { items, hasMore };
  }

  private extractItems(
    response: unknown,
    pageSize: number
  ): { items: unknown[]; hasMore: boolean } {
    if (!response || typeof response !== 'object') {
      return { items: [], hasMore: false };
    }

    const data = response as Record<string, unknown>;
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        const items = data[key] as unknown[];
        return {
          items,
          hasMore: items.length >= pageSize,
        };
      }
    }

    return { items: [], hasMore: false };
  }
}

/**
 * Page number pagination (e.g., page=1, page=2)
 */
export class PageNumberPaginationStrategy implements PaginationStrategy {
  constructor(private config: PaginationConfig) {}

  buildQuery(ctx: PaginationContext): Record<string, string> {
    return {
      [this.config.param]: String(ctx.page + 1), // 1-indexed
    };
  }

  extractResults(response: unknown, ctx: PaginationContext): PageResult {
    const { items, hasMore } = this.extractItems(response, ctx.pageSize);
    return { items, hasMore };
  }

  private extractItems(
    response: unknown,
    pageSize: number
  ): { items: unknown[]; hasMore: boolean } {
    if (!response || typeof response !== 'object') {
      return { items: [], hasMore: false };
    }

    const data = response as Record<string, unknown>;
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        const items = data[key] as unknown[];
        return {
          items,
          hasMore: items.length >= pageSize,
        };
      }
    }

    return { items: [], hasMore: false };
  }
}

/**
 * Cursor-based pagination (e.g., cursor=abc123)
 */
export class CursorPaginationStrategy implements PaginationStrategy {
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

    // Extract items
    let items: unknown[] = [];
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        items = data[key] as unknown[];
        break;
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
