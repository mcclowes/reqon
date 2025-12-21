import { describe, it, expect, beforeEach } from 'vitest';
import {
  OffsetPaginationStrategy,
  PageNumberPaginationStrategy,
  CursorPaginationStrategy,
  createPaginationStrategy,
  clearPaginationCache,
  type PaginationContext,
} from './pagination.js';
import type { PaginationConfig } from '../ast/nodes.js';

describe('Pagination Strategies', () => {
  beforeEach(() => {
    clearPaginationCache();
  });

  describe('OffsetPaginationStrategy', () => {
    it('builds query with offset based on page and pageSize', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 25,
      };
      const strategy = new OffsetPaginationStrategy(config);

      const ctx: PaginationContext = { page: 0, pageSize: 25 };
      expect(strategy.buildQuery(ctx)).toEqual({ offset: '0' });

      ctx.page = 1;
      expect(strategy.buildQuery(ctx)).toEqual({ offset: '25' });

      ctx.page = 2;
      expect(strategy.buildQuery(ctx)).toEqual({ offset: '50' });

      ctx.page = 10;
      expect(strategy.buildQuery(ctx)).toEqual({ offset: '250' });
    });

    it('extracts items from array response', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 10,
      };
      const strategy = new OffsetPaginationStrategy(config);

      const response = {
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        total: 100,
      };

      const ctx: PaginationContext = { page: 0, pageSize: 10 };
      const result = strategy.extractResults(response, ctx);

      expect(result.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(result.hasMore).toBe(false); // 3 < 10
    });

    it('determines hasMore based on pageSize', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 3,
      };
      const strategy = new OffsetPaginationStrategy(config);

      const ctx: PaginationContext = { page: 0, pageSize: 3 };

      // Full page means there might be more
      const fullPage = { items: [1, 2, 3] };
      expect(strategy.extractResults(fullPage, ctx).hasMore).toBe(true);

      // Partial page means no more
      const partialPage = { items: [1, 2] };
      expect(strategy.extractResults(partialPage, ctx).hasMore).toBe(false);

      // Empty page means no more
      const emptyPage = { items: [] };
      expect(strategy.extractResults(emptyPage, ctx).hasMore).toBe(false);
    });

    it('handles non-object response', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 10,
      };
      const strategy = new OffsetPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      expect(strategy.extractResults(null, ctx)).toEqual({ items: [], hasMore: false });
      expect(strategy.extractResults(undefined, ctx)).toEqual({ items: [], hasMore: false });
      expect(strategy.extractResults('string', ctx)).toEqual({ items: [], hasMore: false });
    });

    it('uses custom offset param name', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'skip',
        pageSize: 50,
      };
      const strategy = new OffsetPaginationStrategy(config);

      const ctx: PaginationContext = { page: 2, pageSize: 50 };
      expect(strategy.buildQuery(ctx)).toEqual({ skip: '100' });
    });

    it('caches array field discovery across calls', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 10,
      };
      const strategy = new OffsetPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      // First call discovers 'results' field
      const response1 = { results: [1, 2, 3], meta: {} };
      const result1 = strategy.extractResults(response1, ctx);
      expect(result1.items).toEqual([1, 2, 3]);

      // Subsequent call uses cached field
      const response2 = { results: [4, 5, 6], other: [7, 8, 9] };
      const result2 = strategy.extractResults(response2, ctx);
      expect(result2.items).toEqual([4, 5, 6]);
    });
  });

  describe('PageNumberPaginationStrategy', () => {
    it('builds query with 1-indexed page number', () => {
      const config: PaginationConfig = {
        type: 'page',
        param: 'page',
        pageSize: 20,
      };
      const strategy = new PageNumberPaginationStrategy(config);

      const ctx: PaginationContext = { page: 0, pageSize: 20 };
      expect(strategy.buildQuery(ctx)).toEqual({ page: '1' });

      ctx.page = 1;
      expect(strategy.buildQuery(ctx)).toEqual({ page: '2' });

      ctx.page = 9;
      expect(strategy.buildQuery(ctx)).toEqual({ page: '10' });
    });

    it('extracts items from response', () => {
      const config: PaginationConfig = {
        type: 'page',
        param: 'page',
        pageSize: 5,
      };
      const strategy = new PageNumberPaginationStrategy(config);

      const response = {
        users: [{ name: 'Alice' }, { name: 'Bob' }],
        totalPages: 10,
      };

      const ctx: PaginationContext = { page: 0, pageSize: 5 };
      const result = strategy.extractResults(response, ctx);

      expect(result.items).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
      expect(result.hasMore).toBe(false); // 2 < 5
    });

    it('determines hasMore based on pageSize', () => {
      const config: PaginationConfig = {
        type: 'page',
        param: 'p',
        pageSize: 2,
      };
      const strategy = new PageNumberPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 2 };

      // Full page
      const full = { data: [1, 2] };
      expect(strategy.extractResults(full, ctx).hasMore).toBe(true);

      // Partial page
      const partial = { data: [1] };
      expect(strategy.extractResults(partial, ctx).hasMore).toBe(false);
    });

    it('uses custom page param name', () => {
      const config: PaginationConfig = {
        type: 'page',
        param: 'pageNumber',
        pageSize: 10,
      };
      const strategy = new PageNumberPaginationStrategy(config);

      const ctx: PaginationContext = { page: 4, pageSize: 10 };
      expect(strategy.buildQuery(ctx)).toEqual({ pageNumber: '5' });
    });
  });

  describe('CursorPaginationStrategy', () => {
    it('builds empty query for first page (no cursor)', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'meta.nextCursor',
        pageSize: 100,
      };
      const strategy = new CursorPaginationStrategy(config);

      const ctx: PaginationContext = { page: 0, pageSize: 100 };
      expect(strategy.buildQuery(ctx)).toEqual({});
    });

    it('builds query with cursor for subsequent pages', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'meta.nextCursor',
        pageSize: 100,
      };
      const strategy = new CursorPaginationStrategy(config);

      const ctx: PaginationContext = { page: 1, pageSize: 100, cursor: 'abc123' };
      expect(strategy.buildQuery(ctx)).toEqual({ cursor: 'abc123' });
    });

    it('extracts cursor from nested path', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'after',
        cursorPath: 'pagination.next',
        pageSize: 50,
      };
      const strategy = new CursorPaginationStrategy(config);

      const response = {
        items: [{ id: 1 }, { id: 2 }],
        pagination: {
          next: 'cursor-xyz',
          prev: null,
        },
      };

      const ctx: PaginationContext = { page: 0, pageSize: 50 };
      const result = strategy.extractResults(response, ctx);

      expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('cursor-xyz');
    });

    it('indicates no more pages when cursor is null/undefined', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'nextCursor',
        pageSize: 10,
      };
      const strategy = new CursorPaginationStrategy(config);

      const responseNull = {
        data: [1, 2, 3],
        nextCursor: null,
      };

      const ctx: PaginationContext = { page: 0, pageSize: 10 };
      const result = strategy.extractResults(responseNull, ctx);

      expect(result.items).toEqual([1, 2, 3]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('indicates no more pages when cursorPath field is missing', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'nonExistent.path',
        pageSize: 10,
      };
      const strategy = new CursorPaginationStrategy(config);

      const response = {
        items: [1, 2],
      };

      const ctx: PaginationContext = { page: 0, pageSize: 10 };
      const result = strategy.extractResults(response, ctx);

      expect(result.items).toEqual([1, 2]);
      expect(result.hasMore).toBe(false);
    });

    it('handles non-object response', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'next',
        pageSize: 10,
      };
      const strategy = new CursorPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      expect(strategy.extractResults(null, ctx)).toEqual({ items: [], hasMore: false });
      expect(strategy.extractResults(undefined, ctx)).toEqual({ items: [], hasMore: false });
    });

    it('uses custom cursor param name', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'after',
        cursorPath: 'pageInfo.endCursor',
        pageSize: 25,
      };
      const strategy = new CursorPaginationStrategy(config);

      const ctx: PaginationContext = { page: 1, pageSize: 25, cursor: 'end-cursor-value' };
      expect(strategy.buildQuery(ctx)).toEqual({ after: 'end-cursor-value' });
    });

    it('caches array field discovery', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'next',
        pageSize: 10,
      };
      const strategy = new CursorPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      // First call discovers 'edges' field
      const response1 = { edges: [{ node: 1 }], next: 'c1' };
      const result1 = strategy.extractResults(response1, ctx);
      expect(result1.items).toEqual([{ node: 1 }]);

      // Second call uses cached field
      const response2 = { edges: [{ node: 2 }], other: [999], next: 'c2' };
      const result2 = strategy.extractResults(response2, ctx);
      expect(result2.items).toEqual([{ node: 2 }]);
    });
  });

  describe('createPaginationStrategy', () => {
    it('creates OffsetPaginationStrategy for offset type', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 10,
      };

      const strategy = createPaginationStrategy(config);
      expect(strategy).toBeInstanceOf(OffsetPaginationStrategy);
    });

    it('creates PageNumberPaginationStrategy for page type', () => {
      const config: PaginationConfig = {
        type: 'page',
        param: 'page',
        pageSize: 20,
      };

      const strategy = createPaginationStrategy(config);
      expect(strategy).toBeInstanceOf(PageNumberPaginationStrategy);
    });

    it('creates CursorPaginationStrategy for cursor type', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'next',
        pageSize: 50,
      };

      const strategy = createPaginationStrategy(config);
      expect(strategy).toBeInstanceOf(CursorPaginationStrategy);
    });

    it('throws for unknown pagination type', () => {
      const config = {
        type: 'unknown' as 'offset',
        param: 'x',
        pageSize: 10,
      };

      expect(() => createPaginationStrategy(config)).toThrow('Unknown pagination type: unknown');
    });
  });

  describe('clearPaginationCache', () => {
    it('clears the cache between tests', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 10,
      };
      const strategy = new OffsetPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      // Cache 'fieldA'
      const response1 = { fieldA: [1, 2] };
      strategy.extractResults(response1, ctx);

      // Clear cache
      clearPaginationCache();

      // Now a new strategy should discover the first array field it finds
      const strategy2 = new OffsetPaginationStrategy({
        type: 'offset',
        param: 'skip', // Different param to get different cache key
        pageSize: 10,
      });
      const response2 = { fieldB: [3, 4] };
      const result = strategy2.extractResults(response2, ctx);

      // Should find fieldB
      expect(result.items).toEqual([3, 4]);
    });
  });

  describe('edge cases', () => {
    it('handles response with no arrays', () => {
      const config: PaginationConfig = {
        type: 'offset',
        param: 'offset',
        pageSize: 10,
      };
      const strategy = new OffsetPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      const response = { count: 10, name: 'test', nested: { value: 42 } };
      const result = strategy.extractResults(response, ctx);

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it('handles empty array in response', () => {
      const config: PaginationConfig = {
        type: 'page',
        param: 'page',
        pageSize: 10,
      };
      const strategy = new PageNumberPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      const response = { items: [] };
      const result = strategy.extractResults(response, ctx);

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it('handles cursor value as number', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'cursor',
        cursorPath: 'lastId',
        pageSize: 10,
      };
      const strategy = new CursorPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      const response = { items: [1, 2, 3], lastId: 12345 };
      const result = strategy.extractResults(response, ctx);

      expect(result.nextCursor).toBe('12345');
      expect(result.hasMore).toBe(true);
    });

    it('handles deeply nested cursor path', () => {
      const config: PaginationConfig = {
        type: 'cursor',
        param: 'after',
        cursorPath: 'response.meta.pagination.cursor.next',
        pageSize: 10,
      };
      const strategy = new CursorPaginationStrategy(config);
      const ctx: PaginationContext = { page: 0, pageSize: 10 };

      const response = {
        data: [1, 2],
        response: {
          meta: {
            pagination: {
              cursor: {
                next: 'deep-cursor',
                prev: null,
              },
            },
          },
        },
      };

      const result = strategy.extractResults(response, ctx);
      expect(result.nextCursor).toBe('deep-cursor');
    });
  });
});
