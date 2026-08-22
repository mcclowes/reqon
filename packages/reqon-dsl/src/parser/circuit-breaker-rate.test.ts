import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition } from '../ast/nodes.js';

/**
 * `failureRate` is a proportion. Floored to an integer every usable value
 * becomes 0, which the breaker reads as "rate mode disabled" and falls back to
 * the absolute threshold that rate mode exists to replace - silently, on a
 * source configured precisely to avoid it.
 */
describe('source circuitBreaker failureRate', () => {
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

  it('keeps a fractional failure rate', () => {
    const source = sourceWith(
      `circuitBreaker: { failureRate: 0.25, minimumRequests: 50, resetTimeout: 120 }`
    );

    expect(source.config.circuitBreaker?.failureRate).toBe(0.25);
    expect(source.config.circuitBreaker?.minimumRequests).toBe(50);
  });

  it.each([
    ['0.5', 0.5],
    ['0.05', 0.05],
    ['0.999', 0.999],
    ['1', 1],
  ])('parses failureRate %s', (written, expected) => {
    const source = sourceWith(`circuitBreaker: { failureRate: ${written} }`);

    expect(source.config.circuitBreaker?.failureRate).toBe(expected);
  });

  it('leaves the absolute threshold an integer', () => {
    const source = sourceWith(`circuitBreaker: { failureThreshold: 5, resetTimeout: 30 }`);

    expect(source.config.circuitBreaker?.failureThreshold).toBe(5);
    expect(source.config.circuitBreaker?.failureRate).toBeUndefined();
  });
});
