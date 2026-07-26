import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition } from '../ast/nodes.js';

describe('rateLimit model', () => {
  function sourceWith(config: string): MissionDefinition['sources'][number] {
    const program = new ReqonParser(
      new ReqonLexer(`
        mission M {
          source API {
            auth: none,
            base: "https://api.example.com",
            ${config}
          }
          store items: memory("items")
          action A { get "/items" }
          run A
        }
      `).tokenize()
    ).parse();
    const mission = program.statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
    return mission.sources[0];
  }

  it('parses a token-bucket model', () => {
    const source = sourceWith(
      `rateLimit: { strategy: throttle, model: { type: tokenBucket, capacity: 5000, refill: 300, safety: 0.9 } }`
    );
    expect(source.config.rateLimit?.model).toEqual({
      type: 'tokenBucket',
      capacity: 5000,
      refill: 300,
      safety: 0.9,
    });
  });

  it('parses a model without a safety factor', () => {
    const source = sourceWith(
      `rateLimit: { model: { type: tokenBucket, capacity: 100, refill: 50 } }`
    );
    expect(source.config.rateLimit?.model).toEqual({
      type: 'tokenBucket',
      capacity: 100,
      refill: 50,
    });
  });

  it('rejects an unknown model type', () => {
    expect(() =>
      sourceWith(`rateLimit: { model: { type: leakyFaucet, capacity: 1, refill: 1 } }`)
    ).toThrow(/model type/i);
  });

  it('requires capacity and refill', () => {
    expect(() => sourceWith(`rateLimit: { model: { type: tokenBucket, capacity: 100 } }`)).toThrow(
      /refill/i
    );
  });

  it('leaves model undefined when not specified', () => {
    const source = sourceWith(`rateLimit: { strategy: throttle, fallbackRpm: 30 }`);
    expect(source.config.rateLimit?.model).toBeUndefined();
  });
});
