import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { ActionDefinition, MatchStep } from '../ast/nodes.js';

describe('Match Step Parsing', () => {
  function parseAction(source: string): ActionDefinition {
    const lexer = new ReqonLexer(source);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens, source);
    const program = parser.parse();

    const action = program.statements.find(
      (s) => s.type === 'ActionDefinition'
    ) as ActionDefinition;

    if (!action) {
      throw new Error('No action found in program');
    }

    return action;
  }

  describe('basic match step', () => {
    it('parses match with single schema and flow directive', () => {
      const action = parseAction(`
        action HandleResponse {
          match response {
            SuccessResponse -> continue
          }
        }
      `);

      expect(action.steps).toHaveLength(1);
      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.type).toBe('MatchStep');
      expect(matchStep.arms).toHaveLength(1);
      expect(matchStep.arms[0].schema).toBe('SuccessResponse');
      expect(matchStep.arms[0].flow).toEqual({ type: 'continue' });
    });

    it('parses match with multiple schemas', () => {
      const action = parseAction(`
        action HandleResponse {
          match response {
            SuccessResponse -> continue,
            NotFoundError -> skip,
            ServerError -> abort "Something went wrong"
          }
        }
      `);

      expect(action.steps).toHaveLength(1);
      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms).toHaveLength(3);

      expect(matchStep.arms[0].schema).toBe('SuccessResponse');
      expect(matchStep.arms[0].flow).toEqual({ type: 'continue' });

      expect(matchStep.arms[1].schema).toBe('NotFoundError');
      expect(matchStep.arms[1].flow).toEqual({ type: 'skip' });

      expect(matchStep.arms[2].schema).toBe('ServerError');
      expect(matchStep.arms[2].flow).toEqual({
        type: 'abort',
        message: 'Something went wrong',
      });
    });
  });

  describe('flow directives', () => {
    it('parses continue directive', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> continue
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({ type: 'continue' });
    });

    it('parses skip directive', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> skip
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({ type: 'skip' });
    });

    it('parses abort directive without message', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> abort
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({ type: 'abort' });
    });

    it('parses abort directive with message', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> abort "Error occurred"
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({
        type: 'abort',
        message: 'Error occurred',
      });
    });

    it('parses queue directive without target', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> queue
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({ type: 'queue' });
    });

    it('parses queue directive with target', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> queue deadLetterQueue
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({
        type: 'queue',
        target: 'deadLetterQueue',
      });
    });

    it('parses jump directive without then', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> jump RefreshToken
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({
        type: 'jump',
        action: 'RefreshToken',
      });
    });

    it('parses jump directive with then retry', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> jump RefreshToken then retry
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({
        type: 'jump',
        action: 'RefreshToken',
        then: 'retry',
      });
    });

    it('parses jump directive with then continue', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> jump RefreshToken then continue
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({
        type: 'jump',
        action: 'RefreshToken',
        then: 'continue',
      });
    });

    it('parses retry directive without config', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> retry
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow).toEqual({ type: 'retry' });
    });

    it('parses retry directive with config', () => {
      const action = parseAction(`
        action Test {
          match response {
            Schema -> retry { maxAttempts: 5, backoff: exponential, initialDelay: 1000 }
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].flow?.type).toBe('retry');
      if (matchStep.arms[0].flow?.type === 'retry') {
        expect(matchStep.arms[0].flow.backoff).toEqual({
          maxAttempts: 5,
          backoff: 'exponential',
          initialDelay: 1000,
        });
      }
    });
  });

  describe('match with steps', () => {
    it('parses match with single inline step', () => {
      const action = parseAction(`
        action Test {
          match response {
            SuccessResponse -> store response -> cache
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].schema).toBe('SuccessResponse');
      expect(matchStep.arms[0].steps).toHaveLength(1);
      expect(matchStep.arms[0].steps![0].type).toBe('StoreStep');
    });

    it('parses match with step block', () => {
      const action = parseAction(`
        action Test {
          match response {
            SuccessResponse -> {
              store response -> cache,
              store response -> backup
            }
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms[0].schema).toBe('SuccessResponse');
      expect(matchStep.arms[0].steps).toHaveLength(2);
      expect(matchStep.arms[0].steps![0].type).toBe('StoreStep');
      expect(matchStep.arms[0].steps![1].type).toBe('StoreStep');
    });
  });

  describe('wildcard pattern', () => {
    it('parses wildcard pattern at end', () => {
      const action = parseAction(`
        action Test {
          match response {
            SuccessResponse -> continue,
            _ -> abort "Unexpected response"
          }
        }
      `);

      const matchStep = action.steps[0] as MatchStep;
      expect(matchStep.arms).toHaveLength(2);
      expect(matchStep.arms[1].schema).toBe('_');
      expect(matchStep.arms[1].flow).toEqual({
        type: 'abort',
        message: 'Unexpected response',
      });
    });
  });
});
