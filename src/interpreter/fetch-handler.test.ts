import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FetchStep } from '../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { FetchHandler, type FetchHandlerDeps } from './fetch-handler.js';
import { createContext, setVariable } from './context.js';
import type { HttpClient } from './http.js';
import type { OASSource } from '../oas/index.js';
import type { SyncStore } from '../sync/index.js';

describe('FetchHandler', () => {
  let deps: FetchHandlerDeps;
  let mockClient: HttpClient;
  let mockSyncStore: SyncStore;

  beforeEach(() => {
    mockClient = {
      request: vi.fn(async () => ({
        status: 200,
        data: { result: 'success' },
        headers: {},
      })),
    } as unknown as HttpClient;

    mockSyncStore = {
      getLastSync: vi.fn(async () => null),
      recordSync: vi.fn(async () => {}),
    } as unknown as SyncStore;

    const ctx = createContext();
    ctx.sources.set('api', mockClient);

    deps = {
      ctx,
      oasSources: new Map(),
      sourceConfigs: new Map(),
      syncStore: mockSyncStore,
      missionName: 'testMission',
      executionId: 'exec-123',
      dryRun: false,
      log: vi.fn(),
    };
  });

  describe('idempotency keys', () => {
    const post = (path: string, body: unknown): FetchStep => ({
      type: 'FetchStep',
      source: 'api',
      method: 'POST',
      path: { type: 'Literal', value: path, dataType: 'string' } as Expression,
      body: { type: 'Literal', value: body, dataType: 'object' } as unknown as Expression,
    });
    const keyOf = () =>
      (
        (mockClient.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
          idempotencyKey?: string;
        }
      ).idempotencyKey;

    it('adds a stable Idempotency-Key to mutating requests when enabled', async () => {
      deps.idempotency = { executionId: 'exec-123', stepId: 'A#0' };

      await new FetchHandler(deps).execute(post('/orders', { sku: 1 }));
      const key1 = keyOf();
      expect(key1).toBeTypeOf('string');

      // Same execution + step + request → same key (safe to re-issue on replay).
      (mockClient.request as ReturnType<typeof vi.fn>).mockClear();
      await new FetchHandler(deps).execute(post('/orders', { sku: 1 }));
      expect(keyOf()).toBe(key1);
    });

    it('derives a different key for a different request body (loop-safe)', async () => {
      deps.idempotency = { executionId: 'exec-123', stepId: 'A#0' };
      await new FetchHandler(deps).execute(post('/orders', { sku: 1 }));
      const k1 = keyOf();
      (mockClient.request as ReturnType<typeof vi.fn>).mockClear();
      await new FetchHandler(deps).execute(post('/orders', { sku: 2 }));
      expect(keyOf()).not.toBe(k1);
    });

    it('does not add an Idempotency-Key to safe GET requests', async () => {
      deps.idempotency = { executionId: 'exec-123', stepId: 'A#0' };
      await new FetchHandler(deps).execute({
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/users', dataType: 'string' } as Expression,
      });
      expect(keyOf()).toBeUndefined();
    });

    it('adds no key when idempotency is not enabled', async () => {
      await new FetchHandler(deps).execute(post('/orders', { sku: 1 }));
      expect(keyOf()).toBeUndefined();
    });
  });

  describe('basic fetch', () => {
    it('executes GET request with explicit path', async () => {
      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/users', dataType: 'string' } as Expression,
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        { method: 'GET', path: '/users', query: undefined, body: undefined },
        undefined
      );
      expect(result.data).toEqual({ result: 'success' });
    });

    it('executes POST request with body', async () => {
      setVariable(deps.ctx, 'userData', { name: 'Alice' });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'POST',
        path: { type: 'Literal', value: '/users', dataType: 'string' } as Expression,
        body: { type: 'Identifier', name: 'userData' } as Expression,
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/users',
          body: { name: 'Alice' },
        }),
        undefined
      );
    });

    it('interpolates path variables', async () => {
      setVariable(deps.ctx, 'userId', '123');

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/users/{userId}', dataType: 'string' } as Expression,
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/users/123' }),
        undefined
      );
    });

    it('uses first source when source is not specified', async () => {
      const step: FetchStep = {
        type: 'FetchStep',
        method: 'GET',
        path: { type: 'Literal', value: '/data', dataType: 'string' } as Expression,
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalled();
    });

    it('throws when source not found', async () => {
      const step: FetchStep = {
        type: 'FetchStep',
        source: 'nonExistent',
        method: 'GET',
        path: { type: 'Literal', value: '/data', dataType: 'string' } as Expression,
      };

      const handler = new FetchHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('Source not found: nonExistent');
    });

    it('passes retry config to client', async () => {
      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/data', dataType: 'string' } as Expression,
        retry: {
          maxAttempts: 3,
          backoff: 'exponential',
          initialDelay: 1000,
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(expect.anything(), {
        maxAttempts: 3,
        backoff: 'exponential',
        initialDelay: 1000,
      });
    });
  });

  describe('dry run mode', () => {
    it('skips actual request in dry run mode', async () => {
      deps.dryRun = true;

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/users', dataType: 'string' } as Expression,
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect(mockClient.request).not.toHaveBeenCalled();
      expect(result.data).toEqual({
        _dryRun: true,
        _message: 'No OAS schema available for mock generation',
      });
      expect(deps.log).toHaveBeenCalledWith('(dry run - skipping actual request)');
    });
  });

  describe('OAS operation reference', () => {
    beforeEach(() => {
      const oasSource: OASSource = {
        baseUrl: 'https://api.example.com',
        operations: new Map([
          ['getUsers', { method: 'GET', path: '/users', parameters: [] }],
          ['getUserById', { method: 'GET', path: '/users/{id}', parameters: [] }],
          ['createUser', { method: 'POST', path: '/users', parameters: [] }],
        ]),
      } as unknown as OASSource;

      deps.oasSources.set('api', oasSource);
    });

    it('resolves operationId from OAS spec', async () => {
      const step: FetchStep = {
        type: 'FetchStep',
        operationRef: {
          source: 'api',
          operationId: 'getUsers',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: '/users' }),
        undefined
      );
      expect(deps.log).toHaveBeenCalledWith('Fetching: api.getUsers -> GET /users');
    });

    it('interpolates path parameters in OAS operation', async () => {
      setVariable(deps.ctx, 'id', '456');

      const step: FetchStep = {
        type: 'FetchStep',
        operationRef: {
          source: 'api',
          operationId: 'getUserById',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/users/456' }),
        undefined
      );
    });

    it('throws when source has no OAS spec', async () => {
      deps.oasSources.delete('api');

      const step: FetchStep = {
        type: 'FetchStep',
        operationRef: {
          source: 'api',
          operationId: 'getUsers',
        },
      };

      const handler = new FetchHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow("Source 'api' does not have an OAS spec");
    });
  });

  describe('incremental sync (since)', () => {
    it('adds since parameter for lastSync type', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-15T10:00:00Z'));

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/events', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          param: 'since',
          format: 'iso',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { since: '2024-01-15T10:00:00.000Z' },
        }),
        undefined
      );
    });

    it('uses custom param name for since', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-01T00:00:00Z'));

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/changes', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          param: 'updated_after',
          format: 'iso',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { updated_after: expect.any(String) },
        }),
        undefined
      );
    });

    it('returns checkpoint key for recording', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-01T00:00:00Z'));

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/events', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          key: 'custom-checkpoint-key',
        },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect(result.checkpointKey).toBe('custom-checkpoint-key');
    });

    it('uses expression-based since value', async () => {
      setVariable(deps.ctx, 'lastTimestamp', '2024-06-01T00:00:00Z');

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/data', dataType: 'string' } as Expression,
        since: {
          type: 'expression',
          param: 'from',
          expression: { type: 'Identifier', name: 'lastTimestamp' } as Expression,
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { from: '2024-06-01T00:00:00Z' },
        }),
        undefined
      );
    });

    it('adds since as header when header option specified', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-15T10:00:00Z'));

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/events', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          header: 'If-Modified-Since',
          format: 'iso',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'If-Modified-Since': '2024-01-15T10:00:00.000Z' },
        }),
        undefined
      );
    });

    it('does not add query param when using header option', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-15T10:00:00Z'));

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/events', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          header: 'If-Modified-Since',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          query: undefined,
          headers: { 'If-Modified-Since': expect.any(String) },
        }),
        undefined
      );
    });
  });

  describe('checkpoint recording', () => {
    it('records checkpoint after fetch', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-01T00:00:00Z'));
      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 200,
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        headers: {},
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
        },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      await handler.recordCheckpoint(result.checkpointKey!, step, result.data);

      expect(mockSyncStore.recordSync).toHaveBeenCalledWith(
        expect.objectContaining({
          key: result.checkpointKey,
          recordCount: 3,
          mission: 'testMission',
          executionId: 'exec-123',
        })
      );
    });

    it('extracts timestamp from response using updateFrom', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-01T00:00:00Z'));
      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 200,
        data: {
          items: [{ id: 1 }],
          meta: { lastUpdated: '2024-12-01T12:00:00Z' },
        },
        headers: {},
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          updateFrom: 'meta.lastUpdated',
        },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      await handler.recordCheckpoint(result.checkpointKey!, step, result.data);

      expect(mockSyncStore.recordSync).toHaveBeenCalledWith(
        expect.objectContaining({
          syncedAt: new Date('2024-12-01T12:00:00Z'),
        })
      );
    });

    it('does not record checkpoint if no syncStore', async () => {
      deps.syncStore = undefined;

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        since: { type: 'lastSync' },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      await handler.recordCheckpoint('key', step, result.data);

      // Should not throw, just no-op
    });
  });

  describe('pagination', () => {
    it('fetches multiple pages with offset pagination', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async ({ query }) => {
        callCount++;
        const offset = parseInt(query?.offset ?? '0');
        if (offset >= 6) {
          return { status: 200, data: { items: [] }, headers: {} };
        }
        return {
          status: 200,
          data: { items: [{ id: offset + 1 }, { id: offset + 2 }, { id: offset + 3 }] },
          headers: {},
        };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: {
          type: 'offset',
          param: 'offset',
          pageSize: 3,
        },
      };

      const emit = vi.fn();
      deps.emit = emit;
      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect(Array.isArray(result.data)).toBe(true);
      expect((result.data as unknown[]).length).toBe(6);
      expect(callCount).toBe(3);

      // fetch.complete must report the real page count, not undefined.
      const complete = emit.mock.calls.find((c) => c[0] === 'fetch.complete');
      expect(complete?.[1]).toMatchObject({ pagesFetched: 3, recordCount: 6 });
    });

    it('fetches with page number pagination', async () => {
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async ({ query }) => {
        const page = parseInt(query?.page ?? '1');
        if (page > 2) {
          return { status: 200, data: { data: [] }, headers: {} };
        }
        return {
          status: 200,
          data: { data: [{ id: page }] },
          headers: {},
        };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: {
          type: 'page',
          param: 'page',
          pageSize: 1,
        },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect((result.data as unknown[]).length).toBe(2);
    });

    it('fetches with cursor pagination', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async ({ query }) => {
        callCount++;
        if (query?.cursor === 'end') {
          return {
            status: 200,
            data: { items: [{ id: 3 }], nextCursor: null },
            headers: {},
          };
        }
        if (query?.cursor === 'page2') {
          return {
            status: 200,
            data: { items: [{ id: 2 }], nextCursor: 'end' },
            headers: {},
          };
        }
        return {
          status: 200,
          data: { items: [{ id: 1 }], nextCursor: 'page2' },
          headers: {},
        };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: {
          type: 'cursor',
          param: 'cursor',
          cursorPath: 'nextCursor',
          pageSize: 1,
        },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect((result.data as unknown[]).length).toBe(3);
      expect(callCount).toBe(3);
    });

    it('stops pagination with until condition', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return {
          status: 200,
          data: { items: [{ id: callCount }], done: callCount >= 2 },
          headers: {},
        };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: {
          type: 'offset',
          param: 'offset',
          pageSize: 1,
        },
        until: { type: 'Identifier', name: 'done' } as Expression,
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      // Stops once `done` is true, but the page that triggered the stop is
      // included (no off-by-one data loss): pages 1 and 2 both kept.
      expect(callCount).toBe(2);
      expect((result.data as unknown[]).length).toBe(2);
    });

    it('stops a cursor that stops advancing without looping or duplicating', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        // API bug: always echoes the same cursor, which would loop to the cap.
        return {
          status: 200,
          data: { items: [{ id: callCount }], nextCursor: 'same' },
          headers: {},
        };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: { type: 'cursor', param: 'cursor', cursorPath: 'nextCursor', pageSize: 1 },
      };

      const result = await new FetchHandler(deps).execute(step);

      // First page uses no cursor; second page would reuse 'same' → stop there.
      expect(callCount).toBe(2);
      expect((result.data as unknown[]).length).toBe(2);
    });

    it('respects MAX_PAGINATION_PAGES limit', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return {
          status: 200,
          data: { items: [{ id: callCount }] },
          headers: {},
        };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: {
          type: 'offset',
          param: 'offset',
          pageSize: 1,
        },
      };

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      // Should stop at 100 pages max
      expect(callCount).toBe(100);
      expect(deps.log).toHaveBeenCalledWith('Pagination page limit (100) reached');
      // #246: stopping at the cap must be surfaced as truncation, not silence.
      expect(result.truncated).toEqual({
        reason: 'page-cap',
        pagesFetched: 100,
        itemsFetched: 100,
      });
    });

    // #246: a cap firing must be visible (truncated flag + event) so a sync
    // checkpoint never advances past records that were never fetched.
    describe('truncation (#246)', () => {
      const endless = (perPage = 1): void => {
        let call = 0;
        (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          call++;
          return {
            status: 200,
            data: { items: Array.from({ length: perPage }, (_, i) => ({ id: call * 1000 + i })) },
            headers: {},
          };
        });
      };
      const offsetStep = (maxPages?: number, maxItems?: number): FetchStep => ({
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: { type: 'offset', param: 'offset', pageSize: 1, maxPages, maxItems },
      });

      it('honours a per-step maxPages cap and reports truncation', async () => {
        endless();
        const result = await new FetchHandler(deps).execute(offsetStep(5));
        expect((result.data as unknown[]).length).toBe(5);
        expect(result.truncated).toEqual({ reason: 'page-cap', pagesFetched: 5, itemsFetched: 5 });
      });

      it('honours a per-step maxItems cap and reports truncation', async () => {
        endless(2); // 2 items per page
        const result = await new FetchHandler(deps).execute(offsetStep(undefined, 6));
        expect((result.data as unknown[]).length).toBe(6);
        expect(result.truncated).toEqual({ reason: 'item-cap', pagesFetched: 3, itemsFetched: 6 });
      });

      it('honours a runtime-default cap when no per-step cap is set', async () => {
        endless();
        deps.maxPaginationPages = 3;
        const result = await new FetchHandler(deps).execute(offsetStep());
        expect((result.data as unknown[]).length).toBe(3);
        expect(result.truncated?.reason).toBe('page-cap');
      });

      it('emits a fetch.truncated event when a cap fires', async () => {
        endless();
        const emit = vi.fn();
        deps.emit = emit;
        await new FetchHandler(deps).execute(offsetStep(4));
        expect(emit).toHaveBeenCalledWith(
          'fetch.truncated',
          expect.objectContaining({ reason: 'page-cap', pagesFetched: 4, itemsFetched: 4 })
        );
      });

      it('does not flag truncation when pagination ends naturally on the cap boundary', async () => {
        // Three pages of a pageSize-2 fetch, the last one short so the source
        // itself signals hasMore=false exactly as the page cap is reached.
        let call = 0;
        (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          call++;
          const items = call < 3 ? [{ id: call }, { id: call + 100 }] : [{ id: call }];
          return { status: 200, data: { items }, headers: {} };
        });
        const step: FetchStep = {
          type: 'FetchStep',
          source: 'api',
          method: 'GET',
          path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
          paginate: { type: 'offset', param: 'offset', pageSize: 2, maxPages: 3 },
        };
        const result = await new FetchHandler(deps).execute(step);
        expect((result.data as unknown[]).length).toBe(5);
        expect(result.truncated).toBeUndefined();
      });
    });

    it('logs pagination progress', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount >= 3) {
          return { status: 200, data: { items: [] }, headers: {} };
        }
        return { status: 200, data: { items: [1] }, headers: {} };
      });

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/items', dataType: 'string' } as Expression,
        paginate: {
          type: 'offset',
          param: 'offset',
          pageSize: 1,
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Fetching page 1...');
      expect(deps.log).toHaveBeenCalledWith('Fetching page 2...');
      expect(deps.log).toHaveBeenCalledWith('Fetched 2 total items');
    });
  });

  describe('logging', () => {
    it('logs fetch with method and path', async () => {
      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/users', dataType: 'string' } as Expression,
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Fetching: GET /users');
    });

    it('logs incremental sync info', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2024-01-01T00:00:00Z'));

      const step: FetchStep = {
        type: 'FetchStep',
        source: 'api',
        method: 'GET',
        path: { type: 'Literal', value: '/events', dataType: 'string' } as Expression,
        since: {
          type: 'lastSync',
          param: 'since',
          format: 'iso',
        },
      };

      const handler = new FetchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Incremental sync:'));
    });
  });

  describe('recordCheckpoint', () => {
    const sinceStep = (updateFrom?: string): FetchStep => ({
      type: 'FetchStep',
      source: 'api',
      method: 'GET',
      path: { type: 'Literal', value: '/events', dataType: 'string' } as Expression,
      since: { type: 'lastSync', ...(updateFrom ? { updateFrom } : {}) },
    });

    it('walks a top-level array response for the newest updateFrom timestamp', async () => {
      const data = [
        { id: 1, updated_at: '2026-01-05T00:00:00Z' },
        { id: 2, updated_at: '2026-03-01T00:00:00Z' },
        { id: 3, updated_at: '2026-02-01T00:00:00Z' },
      ];

      const syncedAt = await new FetchHandler(deps).recordCheckpoint(
        'k',
        sinceStep('updated_at'),
        data,
        new Date('2026-07-01T00:00:00Z')
      );

      expect(syncedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });

    it('never records a checkpoint older than the existing watermark', async () => {
      mockSyncStore.getLastSync = vi.fn(async () => new Date('2026-05-01T00:00:00Z'));

      const syncedAt = await new FetchHandler(deps).recordCheckpoint(
        'k',
        sinceStep('updated_at'),
        { updated_at: '2026-04-01T00:00:00Z' },
        new Date('2026-07-01T00:00:00Z')
      );

      expect(syncedAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      expect(mockSyncStore.recordSync).toHaveBeenCalledWith(
        expect.objectContaining({ syncedAt: new Date('2026-05-01T00:00:00Z') })
      );
    });
  });
});
