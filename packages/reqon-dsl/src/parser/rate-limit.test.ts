import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition } from '../ast/nodes.js';

describe('source rateLimit config', () => {
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

  it('parses the throttle strategy', () => {
    const source = sourceWith(`rateLimit: { strategy: throttle, fallbackRpm: 30 }`);

    expect(source.config.rateLimit?.strategy).toBe('throttle');
    expect(source.config.rateLimit?.fallbackRpm).toBe(30);
  });

  it('parses the fail strategy', () => {
    expect(sourceWith(`rateLimit: { strategy: fail }`).config.rateLimit?.strategy).toBe('fail');
  });

  // `pause` is also a step keyword, so it lexes as PAUSE rather than an
  // identifier. Without explicit handling the default strategy is the one
  // strategy that can't be written down.
  it('parses the pause strategy despite pause being a step keyword', () => {
    expect(
      sourceWith(`rateLimit: { strategy: pause, maxWait: 60 }`).config.rateLimit?.strategy
    ).toBe('pause');
  });

  it('rejects an unknown strategy', () => {
    expect(() => sourceWith(`rateLimit: { strategy: 99 }`)).toThrow();
  });
});
