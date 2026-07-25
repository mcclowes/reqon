import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReqonLexer } from './lexer/index.js';
import { ReqonParser } from './parser/parser.js';
import type { ForStep } from './ast/nodes.js';

/**
 * The FPL example is the reference for proxy pools and loop concurrency, so it
 * has to stay parseable and keep saying what the docs claim it says.
 *
 * Scoped to this example on purpose: most other shipped examples don't parse
 * today for unrelated reasons (see issue #222).
 */
describe('fpl-sharded example', () => {
  const dir = join(import.meta.dirname, '..', 'examples', 'fpl-sharded');
  const parse = (file: string) =>
    new ReqonParser(new ReqonLexer(readFileSync(join(dir, file), 'utf8')).tokenize()).parse();

  it('parses the one-request bootstrap mission', () => {
    expect(() => parse('bootstrap.vague')).not.toThrow();
  });

  it('parses the sharded manager mission', () => {
    expect(() => parse('managers.vague')).not.toThrow();
  });

  it('declares a four-proxy egress pool', () => {
    const mission = parse('managers.vague').statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');

    expect(mission.sources[0].config.proxy).toHaveLength(4);
  });

  it('fans the manager loop out concurrently', () => {
    const mission = parse('managers.vague').statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
    const loop = mission.actions[0].steps.find((s): s is ForStep => s.type === 'ForStep');

    expect(loop?.concurrency).toBe(8);
  });
});
