import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition } from '../ast/nodes.js';

describe('source proxy config', () => {
  function parseMission(source: string): MissionDefinition {
    const lexer = new ReqonLexer(source);
    const parser = new ReqonParser(lexer.tokenize());
    const program = parser.parse();
    const mission = program.statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
    return mission;
  }

  function sourceWith(config: string): MissionDefinition['sources'][number] {
    return parseMission(`
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
    `).sources[0];
  }

  it('parses a single proxy as a one-entry pool', () => {
    const source = sourceWith(`proxy: "http://proxy.internal:3128"`);

    expect(source.config.proxy).toHaveLength(1);
    expect(source.config.proxy?.[0]).toMatchObject({
      type: 'Literal',
      value: 'http://proxy.internal:3128',
    });
  });

  it('parses a proxy pool, keeping entries unevaluated', () => {
    const source = sourceWith(`proxy: [env("PROXY_A"), env("PROXY_B"), "http://third:3128"]`);

    expect(source.config.proxy).toHaveLength(3);
    expect(source.config.proxy?.[0]).toMatchObject({ type: 'CallExpression', callee: 'env' });
    expect(source.config.proxy?.[2]).toMatchObject({ type: 'Literal', value: 'http://third:3128' });
  });

  it('leaves proxy undefined when the source does not declare one', () => {
    const source = sourceWith(`rateLimit: { fallbackRpm: 30 }`);

    expect(source.config.proxy).toBeUndefined();
  });

  it('rejects an empty proxy pool', () => {
    expect(() => sourceWith(`proxy: []`)).toThrow(/at least one entry/);
  });
});
