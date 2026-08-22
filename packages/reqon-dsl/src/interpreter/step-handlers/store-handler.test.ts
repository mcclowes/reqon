import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoreStep } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { StoreHandler } from './store-handler.js';
import { createContext, setVariable } from '../context.js';
import type { StepHandlerDeps } from './types.js';
import { MemoryStore } from '../../stores/memory.js';
import { RuntimeError } from '../../errors/index.js';

describe('StoreHandler', () => {
  let deps: StepHandlerDeps;
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore('testStore');
    const ctx = createContext();
    ctx.stores.set('testStore', store);
    deps = {
      ctx,
      log: vi.fn(),
    };
  });

  describe('key validation', () => {
    it('errors when a record has no id and no key option (no random keys)', async () => {
      deps.ctx.response = { name: 'NoId' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      await expect(new StoreHandler(deps).execute(step)).rejects.toThrow(/key/i);
      expect(await store.count()).toBe(0);
    });

    it('errors when the key expression evaluates to undefined/null (no "undefined" key)', async () => {
      deps.ctx.response = { name: 'NoKey' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: { key: { type: 'Identifier', name: 'missingField' } as Expression },
      };

      await expect(new StoreHandler(deps).execute(step)).rejects.toThrow(/key/i);
      expect(await store.get('undefined')).toBeNull();
    });
  });

  describe('storing single records', () => {
    it('stores a single record using id as key', async () => {
      deps.ctx.response = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('user-1');
      expect(result).toEqual({ id: 'user-1', name: 'Alice', email: 'alice@example.com' });
    });

    it('stores with custom key expression', async () => {
      deps.ctx.response = { userId: 'custom-123', name: 'Bob' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          key: { type: 'Identifier', name: 'userId' } as Expression,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('custom-123');
      expect(result).toEqual({ userId: 'custom-123', name: 'Bob' });
    });

    it('stores with computed key expression', async () => {
      deps.ctx.response = { type: 'user', id: '456' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          key: {
            type: 'BinaryExpression',
            operator: '+',
            left: {
              type: 'BinaryExpression',
              operator: '+',
              left: { type: 'Identifier', name: 'type' },
              right: { type: 'Literal', value: '-', dataType: 'string' },
            },
            right: { type: 'Identifier', name: 'id' },
          } as Expression,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('user-456');
      expect(result).toEqual({ type: 'user', id: '456' });
    });

    it('logs when storing single item', async () => {
      deps.ctx.response = { id: '1' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Stored item to testStore');
    });
  });

  describe('storing multiple records', () => {
    it('stores array of records', async () => {
      deps.ctx.response = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '3', name: 'Charlie' },
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(await store.get('1')).toEqual({ id: '1', name: 'Alice' });
      expect(await store.get('2')).toEqual({ id: '2', name: 'Bob' });
      expect(await store.get('3')).toEqual({ id: '3', name: 'Charlie' });
    });

    it('stores array with custom key expression', async () => {
      deps.ctx.response = [
        { uniqueId: 'a', value: 100 },
        { uniqueId: 'b', value: 200 },
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          key: { type: 'Identifier', name: 'uniqueId' } as Expression,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(await store.get('a')).toEqual({ uniqueId: 'a', value: 100 });
      expect(await store.get('b')).toEqual({ uniqueId: 'b', value: 200 });
    });

    it('logs count when storing multiple items', async () => {
      deps.ctx.response = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Stored 5 items to testStore');
    });

    it('does not write any fallback records when one array item has no key', async () => {
      const setSpy = vi.fn(store.set.bind(store));
      const limitedStore = {
        get: store.get.bind(store),
        set: setSpy,
        update: store.update.bind(store),
        delete: store.delete.bind(store),
        list: store.list.bind(store),
        count: store.count.bind(store),
        clear: store.clear.bind(store),
      };
      deps.ctx.stores.set('testStore', limitedStore);

      deps.ctx.response = [{ id: '1', name: 'Alice' }, { name: 'Missing id' }];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      await expect(new StoreHandler(deps).execute(step)).rejects.toThrow(/key/i);

      expect(setSpy).not.toHaveBeenCalled();
      expect(await store.count()).toBe(0);
      expect(await store.get('1')).toBeNull();
    });
  });

  describe('upsert mode', () => {
    it('updates existing record with upsert', async () => {
      // Pre-populate store
      await store.set('user-1', { id: 'user-1', name: 'Alice', age: 25, status: 'active' });

      deps.ctx.response = { id: 'user-1', age: 26 };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          key: { type: 'Identifier', name: 'id' } as Expression,
          upsert: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('user-1');
      expect(result).toEqual({ id: 'user-1', name: 'Alice', age: 26, status: 'active' });
    });

    it('creates new record with upsert if not exists', async () => {
      deps.ctx.response = { id: 'new-user', name: 'NewPerson' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          upsert: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('new-user');
      expect(result).toEqual({ id: 'new-user', name: 'NewPerson' });
    });

    it('upserts multiple records', async () => {
      // Pre-populate with some records
      await store.set('1', { id: '1', name: 'Original1', count: 10 });
      await store.set('2', { id: '2', name: 'Original2', count: 20 });

      deps.ctx.response = [
        { id: '1', count: 15 }, // Update existing
        { id: '2', count: 25 }, // Update existing
        { id: '3', name: 'New3', count: 30 }, // Create new
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          upsert: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(await store.get('1')).toEqual({ id: '1', name: 'Original1', count: 15 });
      expect(await store.get('2')).toEqual({ id: '2', name: 'Original2', count: 25 });
      expect(await store.get('3')).toEqual({ id: '3', name: 'New3', count: 30 });
    });
  });

  describe('partial / merge semantics', () => {
    it('does not leak a _partial flag into stored data or mutate the source record', async () => {
      const record = { id: '1', name: 'PartialData' };
      deps.ctx.response = record;

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: { partial: true },
      };

      await new StoreHandler(deps).execute(step);

      expect(await store.get('1')).toEqual({ id: '1', name: 'PartialData' });
      // The caller's object must be untouched.
      expect(record).toEqual({ id: '1', name: 'PartialData' });
    });

    it('deep-merges a partial record into an existing one without clobbering nested siblings', async () => {
      await store.set('1', { id: '1', profile: { name: 'Alice', city: 'NYC' }, tags: ['a'] });
      deps.ctx.response = { id: '1', profile: { city: 'LA' }, tags: ['b'] };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: { partial: true },
      };

      await new StoreHandler(deps).execute(step);

      expect(await store.get('1')).toEqual({
        id: '1',
        // nested 'name' preserved, 'city' updated (deep merge)
        profile: { name: 'Alice', city: 'LA' },
        // arrays are replaced, not concatenated
        tags: ['b'],
      });
    });

    it('upsert deep-merges instead of shallow-clobbering nested objects', async () => {
      await store.set('1', { id: '1', meta: { a: 1, b: 2 } });
      deps.ctx.response = { id: '1', meta: { b: 3 } };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: { upsert: true },
      };

      await new StoreHandler(deps).execute(step);

      expect(await store.get('1')).toEqual({ id: '1', meta: { a: 1, b: 3 } });
    });
  });

  describe('source from variables', () => {
    it('stores data from a context variable', async () => {
      setVariable(deps.ctx, 'userData', { id: 'var-1', data: 'fromVariable' });

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'userData' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('var-1');
      expect(result).toEqual({ id: 'var-1', data: 'fromVariable' });
    });
  });

  describe('error handling', () => {
    it('throws when store not found', async () => {
      deps.ctx.response = { id: '1' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'nonExistentStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('Store not found: nonExistentStore');
    });
  });

  describe('bulk operations', () => {
    it('uses bulkSet for arrays when available', async () => {
      const bulkSetSpy = vi.spyOn(store, 'bulkSet');

      deps.ctx.response = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(bulkSetSpy).toHaveBeenCalledTimes(1);
      expect(bulkSetSpy).toHaveBeenCalledWith([
        { key: '1', value: { id: '1', name: 'A' } },
        { key: '2', value: { id: '2', name: 'B' } },
        { key: '3', value: { id: '3', name: 'C' } },
      ]);
    });

    it('uses bulkUpsert for arrays when upsert is true', async () => {
      const bulkSetSpy = vi.spyOn(store, 'bulkSet');
      const bulkUpsertSpy = vi.spyOn(store, 'bulkUpsert');

      // Pre-populate with one record to test merging
      await store.set('1', { id: '1', name: 'Original', count: 10 });

      deps.ctx.response = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          upsert: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      // bulkSet should not be called when upsert is true
      expect(bulkSetSpy).not.toHaveBeenCalled();
      // bulkUpsert should be called
      expect(bulkUpsertSpy).toHaveBeenCalledTimes(1);
      expect(bulkUpsertSpy).toHaveBeenCalledWith([
        { key: '1', value: { id: '1', name: 'A' } },
        { key: '2', value: { id: '2', name: 'B' } },
      ]);

      // Verify the upsert behavior: existing record is merged, new record is created
      expect(await store.get('1')).toEqual({ id: '1', name: 'A', count: 10 });
      expect(await store.get('2')).toEqual({ id: '2', name: 'B' });
    });

    it('falls back to individual updates when bulkUpsert is not available', async () => {
      // Create a store without bulkUpsert
      const limitedStore = {
        get: store.get.bind(store),
        set: store.set.bind(store),
        update: store.update.bind(store),
        delete: store.delete.bind(store),
        list: store.list.bind(store),
        count: store.count.bind(store),
        clear: store.clear.bind(store),
        bulkSet: store.bulkSet.bind(store),
        // No bulkUpsert
      };
      deps.ctx.stores.set('testStore', limitedStore);

      const updateSpy = vi.spyOn(limitedStore, 'update');

      deps.ctx.response = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          upsert: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      // Individual update calls should be made
      expect(updateSpy).toHaveBeenCalledTimes(2);
    });
  });

  // Issue #280: a non-array store source used to be cast straight to Record and
  // dereferenced, so a null/empty body threw a raw TypeError and a scalar threw
  // an opaque one - both bypassing the deliberate RuntimeError path. Store
  // errors also all claimed line 1, column 1.
  describe('non-record sources', () => {
    it('treats a null response as a no-op rather than throwing', async () => {
      deps.ctx.response = null;

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      await expect(new StoreHandler(deps).execute(step)).resolves.toBeUndefined();
      expect(await store.count()).toBe(0);
    });

    it('treats an undefined source as a no-op', async () => {
      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        // References a variable that was never set -> evaluates to undefined.
        source: { type: 'Identifier', name: 'missing' } as Expression,
        options: {},
      };

      await expect(new StoreHandler(deps).execute(step)).resolves.toBeUndefined();
      expect(await store.count()).toBe(0);
    });

    it('raises a RuntimeError (not a raw TypeError) for a scalar source', async () => {
      deps.ctx.response = 'just a string';

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      await expect(new StoreHandler(deps).execute(step)).rejects.toThrow(RuntimeError);
      await expect(new StoreHandler(deps).execute(step)).rejects.toThrow(/object or array/i);
      expect(await store.count()).toBe(0);
    });

    it('does not attach a confidently-wrong 1:1 location to store errors', async () => {
      deps.ctx.response = { name: 'NoId' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {},
      };

      await expect(new StoreHandler(deps).execute(step)).rejects.toSatisfy(
        (err: unknown) => err instanceof RuntimeError && err.location === undefined
      );
    });
  });
});
