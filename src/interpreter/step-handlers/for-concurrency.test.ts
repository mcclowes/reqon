import { describe, it, expect, vi } from 'vitest';
import type { ForStep, ActionStep } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { ForHandler, type ForHandlerDeps } from './for-handler.js';
import { createContext, setVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';

/** Resolves after `ms` of real time, so overlap is observable. */
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loop(over: string, concurrency?: number, steps?: ActionStep[]): ForStep {
  return {
    type: 'ForStep',
    variable: 'item',
    collection: { type: 'Identifier', name: over } as Expression,
    steps: steps ?? [
      { type: 'LetStep', name: 'x', value: { type: 'Identifier', name: 'item' } } as ActionStep,
    ],
    concurrency,
  };
}

/**
 * Deps whose executeStep holds each iteration open for `holdMs`, recording the
 * high-water mark of simultaneously in-flight iterations.
 */
function trackingDeps(holdMs = 5) {
  const ctx = createContext();
  let inFlight = 0;
  const state = { peak: 0, order: [] as unknown[], completed: [] as unknown[] };

  const deps: ForHandlerDeps = {
    ctx,
    log: vi.fn(),
    actionName: 'testAction',
    executeStep: vi.fn(async (_step: ActionStep, _action: string, stepCtx: ExecutionContext) => {
      const item = stepCtx.variables.get('item');
      state.order.push(item);
      inFlight++;
      state.peak = Math.max(state.peak, inFlight);
      await tick(holdMs);
      inFlight--;
      state.completed.push(item);
    }),
  };

  return { deps, state };
}

describe('for loop concurrency', () => {
  it('runs one item at a time when concurrency is unset', async () => {
    const { deps, state } = trackingDeps();
    setVariable(deps.ctx, 'items', [1, 2, 3, 4]);

    await new ForHandler(deps).execute(loop('items'));

    expect(state.peak).toBe(1);
    expect(state.completed).toEqual([1, 2, 3, 4]);
  });

  it('overlaps iterations up to the configured limit', async () => {
    const { deps, state } = trackingDeps();
    setVariable(deps.ctx, 'items', [1, 2, 3, 4, 5, 6, 7, 8]);

    await new ForHandler(deps).execute(loop('items', 4));

    expect(state.peak).toBe(4);
  });

  it('never exceeds the limit even with more items than workers', async () => {
    const { deps, state } = trackingDeps();
    setVariable(
      deps.ctx,
      'items',
      Array.from({ length: 50 }, (_, i) => i)
    );

    await new ForHandler(deps).execute(loop('items', 3));

    expect(state.peak).toBe(3);
    expect(state.completed).toHaveLength(50);
  });

  it('visits every item exactly once', async () => {
    const { deps, state } = trackingDeps(1);
    const items = Array.from({ length: 25 }, (_, i) => i);
    setVariable(deps.ctx, 'items', items);

    await new ForHandler(deps).execute(loop('items', 6));

    expect([...state.completed].sort((a, b) => (a as number) - (b as number))).toEqual(items);
  });

  it('applies the where filter before fanning out', async () => {
    const { deps, state } = trackingDeps(1);
    setVariable(
      deps.ctx,
      'items',
      [1, 2, 3, 4, 5, 6].map((n) => ({ n }))
    );
    const step = loop('items', 4);
    step.condition = {
      type: 'BinaryExpression',
      operator: '>',
      left: { type: 'Identifier', name: 'n' },
      right: { type: 'Literal', value: 3, dataType: 'number' },
    } as Expression;

    await new ForHandler(deps).execute(step);

    expect(state.completed.map((i) => (i as { n: number }).n).sort()).toEqual([4, 5, 6]);
  });

  it('stops pulling new items once one fails, then surfaces the error', async () => {
    const ctx = createContext();
    setVariable(
      ctx,
      'items',
      Array.from({ length: 40 }, (_, i) => i)
    );
    const started: unknown[] = [];

    const deps: ForHandlerDeps = {
      ctx,
      log: vi.fn(),
      actionName: 'testAction',
      executeStep: vi.fn(async (_s, _a, stepCtx: ExecutionContext) => {
        const item = stepCtx.variables.get('item') as number;
        started.push(item);
        await tick(2);
        if (item === 1) throw new Error('boom on 1');
      }),
    };

    await expect(new ForHandler(deps).execute(loop('items', 4))).rejects.toThrow('boom on 1');

    // The four in flight when it blew up may finish; the remaining 36 must not start.
    expect(started.length).toBeLessThan(12);
  });

  it('gives each concurrent iteration a distinct, deterministic step-id prefix', async () => {
    const ctx = createContext();
    ctx.actionScope = { stepIndex: 0, attempt: 0, pendingCheckpoints: [] };
    setVariable(ctx, 'items', [10, 20, 30]);
    const seen: Array<{ item: unknown; prefix?: string }> = [];

    const deps: ForHandlerDeps = {
      ctx,
      log: vi.fn(),
      actionName: 'testAction',
      executeStep: vi.fn(async (_s, _a, stepCtx: ExecutionContext) => {
        seen.push({
          item: stepCtx.variables.get('item'),
          prefix: stepCtx.actionScope?.idPrefix,
        });
        await tick(1);
      }),
    };

    await new ForHandler(deps).execute(loop('items', 3));

    expect(seen.sort((a, b) => (a.item as number) - (b.item as number))).toEqual([
      { item: 10, prefix: '[0]' },
      { item: 20, prefix: '[1]' },
      { item: 30, prefix: '[2]' },
    ]);
  });

  it('keeps the action-wide checkpoint list shared across concurrent iterations', async () => {
    const ctx = createContext();
    ctx.actionScope = { stepIndex: 0, attempt: 0, pendingCheckpoints: [] };
    setVariable(ctx, 'items', [1, 2, 3]);

    const deps: ForHandlerDeps = {
      ctx,
      log: vi.fn(),
      actionName: 'testAction',
      executeStep: vi.fn(async (_s, _a, stepCtx: ExecutionContext) => {
        stepCtx.actionScope?.pendingCheckpoints.push(async () => {});
      }),
    };

    await new ForHandler(deps).execute(loop('items', 3));

    expect(ctx.actionScope?.pendingCheckpoints).toHaveLength(3);
  });

  it('falls back to sequential when a debugger is attached', async () => {
    const { deps, state } = trackingDeps();
    setVariable(deps.ctx, 'items', [1, 2, 3, 4]);
    deps.debugController = {
      shouldPause: () => false,
      pause: async () => ({ type: 'continue' }),
    } as unknown as ForHandlerDeps['debugController'];
    deps.captureDebugSnapshot = (() => ({})) as unknown as ForHandlerDeps['captureDebugSnapshot'];
    deps.handleDebugCommand = vi.fn();

    await new ForHandler(deps).execute(loop('items', 4));

    expect(state.peak).toBe(1);
  });
});
