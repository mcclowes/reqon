import { describe, it, expect, vi } from 'vitest';
import type { ForStep, ActionStep } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { ForHandler, type ForHandlerDeps } from './for-handler.js';
import { createContext, setVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';
import { MemoryStore } from '../../stores/memory.js';

/**
 * Per-item failure tolerance.
 *
 * A bulk fan-out is mostly made of items that can fail on their own terms - a
 * manager id that no longer exists, a socket reset, one 500 after its retries.
 * Aborting the run for any of them makes large jobs impossible to finish, so
 * continuing is the default and strictness is opt-in.
 */

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loop(over: string, opts: Partial<ForStep> = {}): ForStep {
  return {
    type: 'ForStep',
    variable: 'item',
    collection: { type: 'Identifier', name: over } as Expression,
    steps: [
      { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
    ],
    ...opts,
  };
}

/** Deps whose iteration throws for any item in `failOn`. */
function failingDeps(failOn: number[]) {
  const ctx = createContext();
  const completed: number[] = [];

  const deps: ForHandlerDeps = {
    ctx,
    log: vi.fn(),
    actionName: 'testAction',
    executeStep: vi.fn(async (_s, _a, stepCtx: ExecutionContext) => {
      const item = stepCtx.variables.get('item') as number;
      await tick(1);
      if (failOn.includes(item)) throw new Error(`boom on ${item}`);
      completed.push(item);
    }),
  };

  return { deps, completed };
}

describe('for loop error tolerance', () => {
  it('completes every healthy item when one fails, sequentially', async () => {
    const { deps, completed } = failingDeps([3]);
    setVariable(deps.ctx, 'items', [1, 2, 3, 4, 5]);

    await new ForHandler(deps).execute(loop('items'));

    expect(completed).toEqual([1, 2, 4, 5]);
  });

  it('completes every healthy item when one fails, concurrently', async () => {
    const { deps, completed } = failingDeps([3, 17]);
    setVariable(
      deps.ctx,
      'items',
      Array.from({ length: 40 }, (_, i) => i)
    );

    await new ForHandler(deps).execute(loop('items', { concurrency: 4 }));

    expect(completed).toHaveLength(38);
    expect(completed).not.toContain(3);
    expect(completed).not.toContain(17);
  });

  it('records failed items in the queue store, leaving healthy ones alone', async () => {
    const { deps, completed } = failingDeps([2]);
    setVariable(deps.ctx, 'items', [1, 2, 3]);
    const failures = new MemoryStore('failures');
    deps.ctx.stores.set('failures', failures);

    await new ForHandler(deps).execute(
      loop('items', { onError: { action: 'continue', queue: 'failures' } })
    );

    expect(completed).toEqual([1, 3]);
    const recorded = await failures.list();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ item: 2, error: 'boom on 2' });
  });

  it('fails loudly when the named queue store does not exist', async () => {
    const { deps } = failingDeps([1]);
    setVariable(deps.ctx, 'items', [1]);

    await expect(
      new ForHandler(deps).execute(
        loop('items', { onError: { action: 'continue', queue: 'nope' } })
      )
    ).rejects.toThrow(/queue store not found: nope/);
  });

  it('still aborts on the first failure under onError abort', async () => {
    const { deps } = failingDeps([1]);
    setVariable(
      deps.ctx,
      'items',
      Array.from({ length: 40 }, (_, i) => i)
    );

    await expect(
      new ForHandler(deps).execute(loop('items', { concurrency: 4, onError: { action: 'abort' } }))
    ).rejects.toThrow('boom on 1');
  });
});
