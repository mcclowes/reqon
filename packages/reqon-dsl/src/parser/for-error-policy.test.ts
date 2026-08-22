import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition, ForStep } from '../ast/nodes.js';

describe('for loop onError clause', () => {
  function forStep(header: string): ForStep {
    const program = new ReqonParser(
      new ReqonLexer(`
        mission M {
          source API { auth: none, base: "https://api.example.com" }
          store items: memory("items")
          store failures: memory("failures")
          action A {
            ${header} {
              get "/items/{row.id}"
            }
          }
          run A
        }
      `).tokenize()
    ).parse();
    const mission = program.statements[0] as MissionDefinition;
    return mission.actions[0].steps[0] as ForStep;
  }

  it('leaves onError unset when the loop does not declare one', () => {
    expect(forStep('for row in items').onError).toBeUndefined();
  });

  it('parses onError continue', () => {
    expect(forStep('for row in items onError continue').onError).toEqual({ action: 'continue' });
  });

  it('parses onError abort', () => {
    expect(forStep('for row in items onError abort').onError).toEqual({ action: 'abort' });
  });

  it('parses onError queue with a target store', () => {
    expect(forStep('for row in items onError queue failures').onError).toEqual({
      action: 'continue',
      queue: 'failures',
    });
  });

  it('composes with concurrency', () => {
    const step = forStep('for row in items concurrency 8 onError queue failures');

    expect(step.concurrency).toBe(8);
    expect(step.onError).toEqual({ action: 'continue', queue: 'failures' });
  });

  it('composes with a where filter', () => {
    const step = forStep('for row in items where .active concurrency 4 onError abort');

    expect(step.condition).toBeDefined();
    expect(step.concurrency).toBe(4);
    expect(step.onError).toEqual({ action: 'abort' });
  });

  it('rejects an unknown onError directive', () => {
    expect(() => forStep('for row in items onError explode')).toThrow(/onError/i);
  });
});
