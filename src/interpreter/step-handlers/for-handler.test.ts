import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ForStep, ActionStep } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { ForHandler, type ForHandlerDeps } from './for-handler.js';
import { createContext, setVariable, childContext } from '../context.js';
import type { ExecutionContext } from '../context.js';
import { MemoryStore } from '../../stores/memory.js';

describe('ForHandler', () => {
  let deps: ForHandlerDeps;
  let executedSteps: Array<{ step: ActionStep; item: unknown }>;

  beforeEach(() => {
    const ctx = createContext();
    executedSteps = [];

    deps = {
      ctx,
      log: vi.fn(),
      executeStep: vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        // Capture the item variable from the context
        const item = stepCtx.variables.get('item');
        executedSteps.push({ step, item });
      }),
      actionName: 'testAction',
    };
  });

  describe('basic iteration', () => {
    it('iterates over an array variable', async () => {
      setVariable(deps.ctx, 'numbers', [1, 2, 3]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'numbers' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(3);
      expect(executedSteps[0].item).toBe(1);
      expect(executedSteps[1].item).toBe(2);
      expect(executedSteps[2].item).toBe(3);
    });

    it('iterates over a variable reference', async () => {
      setVariable(deps.ctx, 'myItems', [{ id: 'a' }, { id: 'b' }]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'myItems' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(2);
      expect(executedSteps[0].item).toEqual({ id: 'a' });
      expect(executedSteps[1].item).toEqual({ id: 'b' });
    });

    it('iterates over variable data', async () => {
      setVariable(deps.ctx, 'users', [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'user',
        collection: { type: 'Identifier', name: 'users' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'user' } } as ActionStep,
        ],
      };

      // Update deps to capture 'user' variable
      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        const item = stepCtx.variables.get('user');
        executedSteps.push({ step, item });
      });

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(3);
      expect(executedSteps[0].item).toEqual({ name: 'Alice' });
      expect(executedSteps[1].item).toEqual({ name: 'Bob' });
      expect(executedSteps[2].item).toEqual({ name: 'Charlie' });
    });

    it('iterates over a store', async () => {
      const store = new MemoryStore('testStore');
      await store.set('1', { id: '1', name: 'First' });
      await store.set('2', { id: '2', name: 'Second' });
      deps.ctx.stores.set('testStore', store);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'record',
        collection: { type: 'Identifier', name: 'testStore' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'record' } } as ActionStep,
        ],
      };

      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        const item = stepCtx.variables.get('record');
        executedSteps.push({ step, item });
      });

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(2);
      const ids = executedSteps.map((s) => (s.item as Record<string, unknown>).id);
      expect(ids).toContain('1');
      expect(ids).toContain('2');
    });
  });

  describe('filtering with where clause', () => {
    it('filters items based on condition', async () => {
      setVariable(deps.ctx, 'users', [
        { name: 'Alice', active: true },
        { name: 'Bob', active: false },
        { name: 'Charlie', active: true },
      ]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'user',
        collection: { type: 'Identifier', name: 'users' } as Expression,
        condition: { type: 'Identifier', name: 'active' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'user' } } as ActionStep,
        ],
      };

      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        const item = stepCtx.variables.get('user');
        executedSteps.push({ step, item });
      });

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(2);
      expect(executedSteps[0].item).toEqual({ name: 'Alice', active: true });
      expect(executedSteps[1].item).toEqual({ name: 'Charlie', active: true });
    });

    it('filters with comparison expression', async () => {
      setVariable(deps.ctx, 'people', [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 },
        { name: 'Charlie', age: 20 },
      ]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'person',
        collection: { type: 'Identifier', name: 'people' } as Expression,
        condition: {
          type: 'BinaryExpression',
          operator: '>',
          left: { type: 'Identifier', name: 'age' },
          right: { type: 'Literal', value: 22, dataType: 'number' },
        } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'person' } } as ActionStep,
        ],
      };

      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        const item = stepCtx.variables.get('person');
        executedSteps.push({ step, item });
      });

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(2);
      expect((executedSteps[0].item as Record<string, unknown>).name).toBe('Alice');
      expect((executedSteps[1].item as Record<string, unknown>).name).toBe('Bob');
    });

    it('filters all items when condition never matches', async () => {
      setVariable(deps.ctx, 'users', [
        { name: 'Alice', status: 'inactive' },
        { name: 'Bob', status: 'inactive' },
      ]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'user',
        collection: { type: 'Identifier', name: 'users' } as Expression,
        condition: {
          type: 'BinaryExpression',
          operator: '==',
          left: { type: 'Identifier', name: 'status' },
          right: { type: 'Literal', value: 'active', dataType: 'string' },
        } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'user' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(0);
    });
  });

  describe('child context isolation', () => {
    it('creates child context for each iteration', async () => {
      const contexts: ExecutionContext[] = [];
      setVariable(deps.ctx, 'items', [1, 2, 3]);

      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        contexts.push(stepCtx);
      });

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'items' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(contexts).toHaveLength(3);
      // Each context should have the parent set
      contexts.forEach((ctx) => {
        expect(ctx.parent).toBe(deps.ctx);
      });
      // Each should have its own variables
      expect(contexts[0].variables.get('item')).toBe(1);
      expect(contexts[1].variables.get('item')).toBe(2);
      expect(contexts[2].variables.get('item')).toBe(3);
    });

    it('child context shares stores with parent', async () => {
      const store = new MemoryStore('shared');
      deps.ctx.stores.set('shared', store);
      setVariable(deps.ctx, 'items', [{ id: '1' }]);

      let capturedCtx: ExecutionContext | null = null;
      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, stepCtx: ExecutionContext) => {
        capturedCtx = stepCtx;
      });

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'items' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(capturedCtx!.stores).toBe(deps.ctx.stores);
      expect(capturedCtx!.stores.get('shared')).toBe(store);
    });
  });

  describe('nested steps execution', () => {
    it('executes multiple steps per iteration', async () => {
      setVariable(deps.ctx, 'items', [{ id: 1 }, { id: 2 }]);
      let stepCallCount = 0;

      deps.executeStep = vi.fn(async () => {
        stepCallCount++;
      });

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'items' } as Expression,
        steps: [
          { type: 'LetStep', name: 'a', value: { type: 'Literal', value: 1, dataType: 'number' } } as ActionStep,
          { type: 'LetStep', name: 'b', value: { type: 'Literal', value: 2, dataType: 'number' } } as ActionStep,
          { type: 'LetStep', name: 'c', value: { type: 'Literal', value: 3, dataType: 'number' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      // 2 items × 3 steps = 6 total step executions
      expect(stepCallCount).toBe(6);
    });
  });

  describe('logging', () => {
    it('logs the iteration count', async () => {
      setVariable(deps.ctx, 'items', [1, 2, 3, 4, 5]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'items' } as Expression,
        steps: [],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Iterating over 5 items');
    });

    it('logs filtered count when condition is present', async () => {
      setVariable(deps.ctx, 'items', [
        { active: true },
        { active: false },
        { active: true },
      ]);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'items' } as Expression,
        condition: { type: 'Identifier', name: 'active' } as Expression,
        steps: [],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Iterating over 2 items');
    });
  });

  describe('error handling', () => {
    it('throws when collection is not an array', async () => {
      setVariable(deps.ctx, 'notAnArray', { key: 'value' });

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'notAnArray' } as Expression,
        steps: [],
      };

      const handler = new ForHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('For loop collection must be an array');
    });

    it('handles empty collection gracefully', async () => {
      setVariable(deps.ctx, 'items', []);

      const step: ForStep = {
        type: 'ForStep',
        variable: 'item',
        collection: { type: 'Identifier', name: 'items' } as Expression,
        steps: [
          { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
        ],
      };

      const handler = new ForHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(0);
      expect(deps.log).toHaveBeenCalledWith('Iterating over 0 items');
    });
  });
});
