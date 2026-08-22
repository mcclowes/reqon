import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { ForStep } from '../ast/nodes.js';

describe('for loop concurrency', () => {
  function parseForStep(loop: string): ForStep {
    const lexer = new ReqonLexer(`
      mission M {
        source API { auth: none, base: "https://api.example.com" }
        store ids: memory("ids")
        store out: memory("out")
        action A {
          ${loop}
        }
        run A
      }
    `);
    const mission = new ReqonParser(lexer.tokenize()).parse().statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
    const step = mission.actions[0].steps[0];
    if (step.type !== 'ForStep') throw new Error(`Expected a ForStep, got ${step.type}`);
    return step;
  }

  it('defaults to no concurrency, preserving sequential iteration', () => {
    const step = parseForStep(`for id in ids { get "/entry/{id}" }`);

    expect(step.concurrency).toBeUndefined();
  });

  it('parses a concurrency clause', () => {
    const step = parseForStep(`for id in ids concurrency 8 { get "/entry/{id}" }`);

    expect(step.concurrency).toBe(8);
  });

  it('parses concurrency after a where clause', () => {
    const step = parseForStep(`for id in ids where .active concurrency 4 { get "/entry/{id}" }`);

    expect(step.concurrency).toBe(4);
    expect(step.condition).toBeDefined();
  });

  it('rejects a concurrency below 1', () => {
    expect(() => parseForStep(`for id in ids concurrency 0 { get "/x" }`)).toThrow(
      /concurrency must be at least 1/i
    );
  });
});
