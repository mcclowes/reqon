import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoreStep } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { StoreHandler } from './store-handler.js';
import { createContext, setVariable } from '../context.js';
import type { StepHandlerDeps } from './types.js';
import { MemoryStore } from '../../stores/memory.js';

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
      deps.ctx.response = [
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' },
        { id: '5' },
      ];

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

  describe('partial flag', () => {
    it('marks single record as partial', async () => {
      deps.ctx.response = { id: '1', name: 'PartialData' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          partial: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('1');
      expect(result).toEqual({ id: '1', name: 'PartialData', _partial: true });
    });

    it('marks multiple records as partial', async () => {
      deps.ctx.response = [
        { id: '1', summary: 'First' },
        { id: '2', summary: 'Second' },
      ];

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          partial: true,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      expect(await store.get('1')).toEqual({ id: '1', summary: 'First', _partial: true });
      expect(await store.get('2')).toEqual({ id: '2', summary: 'Second', _partial: true });
    });

    it('can set partial to false explicitly', async () => {
      deps.ctx.response = { id: '1', name: 'CompleteData' };

      const step: StoreStep = {
        type: 'StoreStep',
        target: 'testStore',
        source: { type: 'Identifier', name: 'response' } as Expression,
        options: {
          partial: false,
        },
      };

      const handler = new StoreHandler(deps);
      await handler.execute(step);

      const result = await store.get('1');
      expect(result).toEqual({ id: '1', name: 'CompleteData', _partial: false });
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

    it('falls back to individual operations for upserts', async () => {
      const bulkSetSpy = vi.spyOn(store, 'bulkSet');
      const updateSpy = vi.spyOn(store, 'update');

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
      // Individual update calls should be made
      expect(updateSpy).toHaveBeenCalledTimes(2);
    });
  });
});
