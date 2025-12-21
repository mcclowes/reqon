import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FetchStep, RetryConfig, PaginationConfig } from '../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { FetchHandler, type FetchHandlerDeps, type FetchResult } from './fetch-handler.js';
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

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.anything(),
        { maxAttempts: 3, backoff: 'exponential', initialDelay: 1000 }
      );
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
      expect(result.data).toEqual({ dryRun: true });
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
      await expect(handler.execute(step)).rejects.toThrow(
        "Source 'api' does not have an OAS spec"
      );
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

      const handler = new FetchHandler(deps);
      const result = await handler.execute(step);

      expect(Array.isArray(result.data)).toBe(true);
      expect((result.data as unknown[]).length).toBe(6);
      expect(callCount).toBe(3);
    });

    it('fetches with page number pagination', async () => {
      let callCount = 0;
      (mockClient.request as ReturnType<typeof vi.fn>).mockImplementation(async ({ query }) => {
        callCount++;
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

      // Should stop when done is true
      expect(callCount).toBe(2);
      expect((result.data as unknown[]).length).toBe(1); // Only first page since we break on done
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
      await handler.execute(step);

      // Should stop at 100 pages max
      expect(callCount).toBe(100);
      expect(deps.log).toHaveBeenCalledWith('Warning: pagination limit (100) reached');
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
});
