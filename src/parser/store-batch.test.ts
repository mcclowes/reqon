import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition } from '../ast/nodes.js';

describe('store batch option', () => {
  function storeWith(decl: string): MissionDefinition['stores'][number] {
    const program = new ReqonParser(
      new ReqonLexer(`
        mission M {
          source API { auth: none, base: "https://api.example.com" }
          ${decl}
          action A { get "/x" }
          run A
        }
      `).tokenize()
    ).parse();
    const mission = program.statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
    return mission.stores[0];
  }

  it('parses a bare batch size', () => {
    const store = storeWith(`store managers: postgrest("t") { batch: 500 }`);
    expect(store.batch).toEqual({ size: 500 });
  });

  it('parses a full batch config', () => {
    const store = storeWith(
      `store managers: postgrest("t") { batch: { size: 500, maxDelay: 200, durability: relaxed } }`
    );
    expect(store.batch).toEqual({ size: 500, maxDelay: 200, durability: 'relaxed' });
  });

  it('accepts strict durability explicitly', () => {
    const store = storeWith(`store m: file("t") { batch: { size: 10, durability: strict } }`);
    expect(store.batch).toEqual({ size: 10, durability: 'strict' });
  });

  it('leaves batch undefined when not specified', () => {
    const store = storeWith(`store m: memory("t")`);
    expect(store.batch).toBeUndefined();
  });

  it('rejects an unknown durability', () => {
    expect(() => storeWith(`store m: file("t") { batch: { size: 5, durability: yolo } }`)).toThrow(
      /durability/i
    );
  });

  it('rejects an unknown batch option', () => {
    expect(() => storeWith(`store m: file("t") { batch: { size: 5, nope: 1 } }`)).toThrow(/batch/i);
  });
});
