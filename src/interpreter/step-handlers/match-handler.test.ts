import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchStep, ActionStep, FlowDirective, MatchArm } from '../../ast/nodes.js';
import type { Expression, SchemaDefinition } from 'vague-lang';
import { MatchHandler, type MatchHandlerDeps } from './match-handler.js';
import { createContext, setVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';
import {
  NoMatchError,
  AbortError,
  SkipSignal,
  RetrySignal,
  JumpSignal,
  QueueSignal,
} from '../signals.js';

describe('MatchHandler', () => {
  let deps: MatchHandlerDeps;
  let executedSteps: ActionStep[];

  beforeEach(() => {
    const ctx = createContext();
    executedSteps = [];

    // Register some test schemas with proper FieldType structure
    ctx.schemas.set('SuccessResponse', {
      name: 'SuccessResponse',
      fields: [
        { name: 'status', fieldType: { type: 'PrimitiveType', name: 'string' } },
        { name: 'data', fieldType: { type: 'PrimitiveType', name: 'any' }, optional: true },
      ],
    } as unknown as SchemaDefinition);

    ctx.schemas.set('ErrorResponse', {
      name: 'ErrorResponse',
      fields: [
        { name: 'error', fieldType: { type: 'PrimitiveType', name: 'string' } },
        { name: 'code', fieldType: { type: 'PrimitiveType', name: 'int' } },
      ],
    } as unknown as SchemaDefinition);

    ctx.schemas.set('PaginatedResponse', {
      name: 'PaginatedResponse',
      fields: [
        { name: 'items', fieldType: { type: 'CollectionType', elementType: { type: 'PrimitiveType', name: 'any' } } },
        { name: 'nextPage', fieldType: { type: 'PrimitiveType', name: 'string' }, optional: true },
      ],
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

  describe('schema matching', () => {
    it('matches first matching schema', async () => {
      deps.ctx.response = { status: 'ok', data: { id: 1 } };

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [
              { type: 'LetStep', name: 'result', value: { type: 'Literal', value: 'success', dataType: 'string' } } as ActionStep,
            ],
          },
          {
            schema: 'ErrorResponse',
            steps: [
              { type: 'LetStep', name: 'result', value: { type: 'Literal', value: 'error', dataType: 'string' } } as ActionStep,
            ],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Matched schema: SuccessResponse');
      expect(executedSteps).toHaveLength(1);
      expect(executedSteps[0].type).toBe('LetStep');
    });

    it('matches error response schema', async () => {
      deps.ctx.response = { error: 'Not found', code: 404 };

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [],
          },
          {
            schema: 'ErrorResponse',
            steps: [
              { type: 'LetStep', name: 'errorCode', value: { type: 'Identifier', name: 'code' } } as ActionStep,
            ],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Matched schema: ErrorResponse');
      expect(executedSteps).toHaveLength(1);
    });

    it('matches wildcard _ when no other schema matches', async () => {
      deps.ctx.response = { unknownField: 'value' };

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [],
          },
          {
            schema: 'ErrorResponse',
            steps: [],
          },
          {
            schema: '_',
            steps: [
              { type: 'LetStep', name: 'fallback', value: { type: 'Literal', value: true, dataType: 'boolean' } } as ActionStep,
            ],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Matched schema: _');
      expect(executedSteps).toHaveLength(1);
    });

    it('throws NoMatchError when no schema matches', async () => {
      deps.ctx.response = { randomField: 'value' };

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [],
          },
          {
            schema: 'ErrorResponse',
            steps: [],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow(NoMatchError);
    });
  });

  describe('flow directives', () => {
    describe('skip directive', () => {
      it('throws SkipSignal when skip flow is triggered', async () => {
        deps.ctx.response = { status: 'ok', data: null };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'SuccessResponse',
              flow: { type: 'skip' },
            },
          ],
        };

        const handler = new MatchHandler(deps);
        await expect(handler.execute(step)).rejects.toThrow(SkipSignal);
        expect(executedSteps).toHaveLength(0);
      });
    });

    describe('abort directive', () => {
      it('throws AbortError with default message', async () => {
        deps.ctx.response = { error: 'Fatal', code: 500 };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'ErrorResponse',
              flow: { type: 'abort' },
            },
          ],
        };

        const handler = new MatchHandler(deps);
        await expect(handler.execute(step)).rejects.toThrow(AbortError);
        await expect(handler.execute(step)).rejects.toThrow('Execution aborted');
      });

      it('throws AbortError with custom message', async () => {
        deps.ctx.response = { error: 'Auth failed', code: 401 };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'ErrorResponse',
              flow: { type: 'abort', message: 'Authentication required' },
            },
          ],
        };

        const handler = new MatchHandler(deps);
        await expect(handler.execute(step)).rejects.toThrow('Authentication required');
      });
    });

    describe('retry directive', () => {
      it('throws RetrySignal without backoff config', async () => {
        deps.ctx.response = { error: 'Rate limited', code: 429 };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'ErrorResponse',
              flow: { type: 'retry' },
            },
          ],
        };

        const handler = new MatchHandler(deps);

        try {
          await handler.execute(step);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(RetrySignal);
          expect((e as RetrySignal).backoff).toBeUndefined();
        }
      });

      it('throws RetrySignal with backoff config', async () => {
        deps.ctx.response = { error: 'Temporary failure', code: 503 };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'ErrorResponse',
              flow: {
                type: 'retry',
                backoff: {
                  maxAttempts: 3,
                  backoff: 'exponential',
                  initialDelay: 1000,
                },
              },
            },
          ],
        };

        const handler = new MatchHandler(deps);

        try {
          await handler.execute(step);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(RetrySignal);
          const signal = e as RetrySignal;
          expect(signal.backoff).toEqual({
            maxAttempts: 3,
            backoff: 'exponential',
            initialDelay: 1000,
          });
        }
      });
    });

    describe('jump directive', () => {
      it('throws JumpSignal with target action', async () => {
        deps.ctx.response = { items: [], nextPage: 'page2' };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'PaginatedResponse',
              flow: { type: 'jump', action: 'fetchNextPage' },
            },
          ],
        };

        const handler = new MatchHandler(deps);

        try {
          await handler.execute(step);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(JumpSignal);
          expect((e as JumpSignal).action).toBe('fetchNextPage');
          expect((e as JumpSignal).then).toBeUndefined();
        }
      });

      it('throws JumpSignal with then modifier', async () => {
        deps.ctx.response = { items: [], nextPage: null };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'PaginatedResponse',
              flow: { type: 'jump', action: 'finalize', then: 'continue' },
            },
          ],
        };

        const handler = new MatchHandler(deps);

        try {
          await handler.execute(step);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(JumpSignal);
          const signal = e as JumpSignal;
          expect(signal.action).toBe('finalize');
          expect(signal.then).toBe('continue');
        }
      });
    });

    describe('queue directive', () => {
      it('throws QueueSignal with value', async () => {
        deps.ctx.response = { error: 'Needs review', code: 422 };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'ErrorResponse',
              flow: { type: 'queue' },
            },
          ],
        };

        const handler = new MatchHandler(deps);

        try {
          await handler.execute(step);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(QueueSignal);
          expect((e as QueueSignal).value).toEqual({ error: 'Needs review', code: 422 });
        }
      });

      it('throws QueueSignal with target', async () => {
        deps.ctx.response = { error: 'Queued', code: 202 };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'ErrorResponse',
              flow: { type: 'queue', target: 'retryQueue' },
            },
          ],
        };

        const handler = new MatchHandler(deps);

        try {
          await handler.execute(step);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(QueueSignal);
          expect((e as QueueSignal).target).toBe('retryQueue');
        }
      });
    });

    describe('continue directive', () => {
      it('returns normally without executing steps', async () => {
        deps.ctx.response = { status: 'ok', data: {} };

        const step: MatchStep = {
          type: 'MatchStep',
          target: { type: 'Identifier', name: 'response' } as Expression,
          arms: [
            {
              schema: 'SuccessResponse',
              flow: { type: 'continue' },
              steps: [
                { type: 'LetStep', name: 'x', value: { type: 'Literal', value: 1, dataType: 'number' } } as ActionStep,
              ],
            },
          ],
        };

        const handler = new MatchHandler(deps);
        await expect(handler.execute(step)).resolves.not.toThrow();

        // Steps should not be executed when continue is specified
        expect(executedSteps).toHaveLength(0);
      });
    });
  });

  describe('step execution', () => {
    it('executes multiple steps in order', async () => {
      deps.ctx.response = { status: 'ok', data: { value: 42 } };

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [
              { type: 'LetStep', name: 'step1', value: { type: 'Literal', value: 1, dataType: 'number' } } as ActionStep,
              { type: 'LetStep', name: 'step2', value: { type: 'Literal', value: 2, dataType: 'number' } } as ActionStep,
              { type: 'LetStep', name: 'step3', value: { type: 'Literal', value: 3, dataType: 'number' } } as ActionStep,
            ],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(3);
    });

    it('executes steps with correct context', async () => {
      deps.ctx.response = { status: 'processed', data: {} };

      let capturedCtx: ExecutionContext | null = null;
      deps.executeStep = vi.fn(async (step: ActionStep, actionName: string, ctx: ExecutionContext) => {
        capturedCtx = ctx;
        executedSteps.push(step);
      });

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [
              { type: 'LetStep', name: 'x', value: { type: 'Literal', value: 1, dataType: 'number' } } as ActionStep,
            ],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(capturedCtx).toBe(deps.ctx);
    });

    it('does not execute steps when arm has no steps', async () => {
      deps.ctx.response = { status: 'ok', data: null };

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            // No steps property
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(executedSteps).toHaveLength(0);
    });
  });

  describe('target from variable', () => {
    it('matches against a context variable', async () => {
      setVariable(deps.ctx, 'apiResponse', { status: 'complete', data: [1, 2, 3] });

      const step: MatchStep = {
        type: 'MatchStep',
        target: { type: 'Identifier', name: 'apiResponse' } as Expression,
        arms: [
          {
            schema: 'SuccessResponse',
            steps: [
              { type: 'LetStep', name: 'matched', value: { type: 'Literal', value: true, dataType: 'boolean' } } as ActionStep,
            ],
          },
        ],
      };

      const handler = new MatchHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Matched schema: SuccessResponse');
      expect(executedSteps).toHaveLength(1);
    });
  });
});
