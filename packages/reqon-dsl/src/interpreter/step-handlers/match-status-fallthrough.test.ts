import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchStep, ActionStep } from '../../ast/nodes.js';
import type { Expression, SchemaDefinition } from 'vague-lang';
import { MatchHandler, type MatchHandlerDeps } from './match-handler.js';
import { createContext } from '../context.js';
import { NoMatchError, SkipSignal } from '../signals.js';

/**
 * `allow: [404]` plus `404 -> skip` is the documented pair for tolerating a
 * missing record. A match written purely on statuses is a status dispatch, not
 * a schema assertion, so an unhandled status carries on instead of failing the
 * step - otherwise every successful response needs a `_ -> continue` companion.
 */
describe('MatchHandler status dispatch', () => {
  let deps: MatchHandlerDeps;
  let executedSteps: ActionStep[];

  beforeEach(() => {
    const ctx = createContext();
    executedSteps = [];

    ctx.schemas.set('Manager', {
      name: 'Manager',
      fields: [{ name: 'id', fieldType: { type: 'PrimitiveType', name: 'int' } }],
    } as unknown as SchemaDefinition);

    deps = {
      ctx,
      log: vi.fn(),
      executeStep: vi.fn(async (step: ActionStep) => {
        executedSteps.push(step);
      }),
      actionName: 'testAction',
    };
  });

  const target = { type: 'Identifier', name: 'response' } as Expression;

  it('falls through when a status-only match has no arm for the status', async () => {
    deps.ctx.response = { current: [], past: [], chips: [] };
    deps.ctx.responseStatus = 200;

    const step: MatchStep = {
      type: 'MatchStep',
      target,
      arms: [{ schema: '404', status: 404, flow: { type: 'skip' } }],
    };

    await expect(new MatchHandler(deps).execute(step)).resolves.toBeUndefined();
    expect(executedSteps).toHaveLength(0);
  });

  it('still dispatches when the status does match', async () => {
    deps.ctx.response = { detail: 'Not found' };
    deps.ctx.responseStatus = 404;

    const step: MatchStep = {
      type: 'MatchStep',
      target,
      arms: [{ schema: '404', status: 404, flow: { type: 'skip' } }],
    };

    await expect(new MatchHandler(deps).execute(step)).rejects.toThrow(SkipSignal);
  });

  it('falls through with several status arms and none matching', async () => {
    deps.ctx.response = { ok: true };
    deps.ctx.responseStatus = 200;

    const step: MatchStep = {
      type: 'MatchStep',
      target,
      arms: [
        { schema: '404', status: 404, flow: { type: 'skip' } },
        { schema: '429', status: 429, flow: { type: 'retry' } },
      ],
    };

    await expect(new MatchHandler(deps).execute(step)).resolves.toBeUndefined();
  });

  it('keeps exhaustiveness when any arm asserts a schema', async () => {
    deps.ctx.response = { unexpected: true };
    deps.ctx.responseStatus = 200;

    const step: MatchStep = {
      type: 'MatchStep',
      target,
      arms: [
        { schema: 'Manager', steps: [] },
        { schema: '404', status: 404, flow: { type: 'skip' } },
      ],
    };

    await expect(new MatchHandler(deps).execute(step)).rejects.toThrow(NoMatchError);
  });

  it('names the arms that were tried when a schema match fails', async () => {
    deps.ctx.response = { unexpected: true };
    deps.ctx.responseStatus = 200;

    const step: MatchStep = {
      type: 'MatchStep',
      target,
      arms: [{ schema: 'Manager', steps: [] }],
    };

    await expect(new MatchHandler(deps).execute(step)).rejects.toThrow(
      /Manager.*add a `_` arm|add a `_` arm.*Manager/s
    );
  });
});
