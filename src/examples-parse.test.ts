import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ReqonLexer } from './lexer/index.js';
import { ReqonParser } from './parser/parser.js';
import type { ForStep, MatchStep, ValidateStep, StoreStep, ActionDefinition } from './ast/nodes.js';
import type { ObjectLiteralExpression } from './parser/expressions.js';

const examplesDir = join(import.meta.dirname, '..', 'examples');
const parseExample = (...segments: string[]) =>
  new ReqonParser(
    new ReqonLexer(readFileSync(join(examplesDir, ...segments), 'utf8')).tokenize()
  ).parse();

/**
 * Every shipped example is documented as runnable, so a parse failure is a
 * broken doc. This is the gate that keeps that claim honest — it walks the
 * directory rather than naming files, so a new example is covered on arrival.
 */
describe('every shipped example parses', () => {
  const exampleFiles = readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(join(examplesDir, d.name))
        .filter((f) => f.endsWith('.vague') || f.endsWith('.reqon'))
        .map((f) => [d.name, f] as const)
    );

  it('finds the examples directory', () => {
    expect(exampleFiles.length).toBeGreaterThan(20);
  });

  it.for(exampleFiles)('%s/%s', ([dir, file]) => {
    expect(() => parseExample(dir, file)).not.toThrow();
  });
});

/**
 * The FPL example is the reference for proxy pools and loop concurrency, so it
 * has to keep saying what the docs claim it says, not merely parse.
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

  it('paces under a token-bucket model, not a flat rate', () => {
    const mission = parse('managers.vague').statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');

    // FPL is headerless, so the run relies on modeling its limiter and letting
    // 429 feedback self-calibrate the pace. A flat fallbackRpm can't learn.
    const model = mission.sources[0].config.rateLimit?.model;
    expect(model?.type).toBe('tokenBucket');
    expect(model?.capacity).toBeGreaterThan(0);
    expect(model?.refill).toBeGreaterThan(0);
  });
});

/**
 * The bulk pull generates its own ids with range() instead of reading a shard
 * file, so there's no orchestrator and no 500k-line input to hand-write.
 */
describe('fpl-sharded first-500k bulk example', () => {
  const dir = join(import.meta.dirname, '..', 'examples', 'fpl-sharded');
  const parse = (file: string) =>
    new ReqonParser(new ReqonLexer(readFileSync(join(dir, file), 'utf8')).tokenize()).parse();

  it('parses the bulk mission', () => {
    expect(() => parse('first-500k.vague')).not.toThrow();
  });

  it('iterates a numeric range in-mission, not a store', () => {
    const mission = parse('first-500k.vague').statements[0];
    if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
    const loop = mission.actions[0].steps.find((s): s is ForStep => s.type === 'ForStep');

    expect(loop?.collection.type).toBe('CallExpression');
    // range(1, 500001) -> the first 500,000 managers.
    const call = loop?.collection as { callee: string; arguments: Array<{ value: number }> };
    expect(call.callee).toBe('range');
    expect(call.arguments[1].value).toBe(500001);
    expect(loop?.concurrency).toBe(192);
  });
});

/**
 * These examples are the reference showcases for the features that close the
 * README feature-index gap. Each assertion keeps the example demonstrating the
 * advertised syntax (not just parsing), so the docs and the parser can't drift
 * apart again.
 */
describe('feature-showcase examples', () => {
  it('github-sync matches an array-of-schema pattern ([GitHubIssue])', () => {
    const action = parseExample('github-sync', 'fetch-issues.vague').statements.find(
      (s): s is ActionDefinition => s.type === 'ActionDefinition'
    );
    const matchStep = action?.steps.find((s): s is MatchStep => s.type === 'MatchStep');
    const arrayArm = matchStep?.arms.find((a) => a.isArray);

    expect(arrayArm?.schema).toBe('GitHubIssue');
    expect(arrayArm?.isArray).toBe(true);
  });

  it('temporal-comparison uses a validate ... or fallback block', () => {
    const mission = parseExample('temporal-comparison', 'reconciliation.vague').statements.find(
      (s) => s.type === 'MissionDefinition'
    );
    if (mission?.type !== 'MissionDefinition') throw new Error('Expected a mission');

    const validateWithFallback = mission.actions
      .flatMap((a) => collectSteps(a))
      .find((s): s is ValidateStep => s.type === 'ValidateStep' && !!s.fallback?.length);

    expect(validateWithFallback).toBeDefined();
    expect(validateWithFallback?.fallback?.[0].type).toBe('StoreStep');
  });

  it('data-enrichment spreads a record into a store literal', () => {
    const mission = parseExample('data-enrichment', 'enrichment.vague').statements.find(
      (s) => s.type === 'MissionDefinition'
    );
    if (mission?.type !== 'MissionDefinition') throw new Error('Expected a mission');

    const spreadStore = mission.actions
      .flatMap((a) => collectSteps(a))
      .find((s): s is StoreStep => {
        if (s.type !== 'StoreStep') return false;
        const source = s.source as unknown as ObjectLiteralExpression;
        return source.type === 'ObjectLiteral' && source.properties.some((p) => p.spread);
      });

    expect(spreadStore).toBeDefined();
  });
});

/** Flatten an action's steps, descending into for-loop bodies. */
function collectSteps(action: ActionDefinition) {
  const out: ActionDefinition['steps'] = [];
  const visit = (steps: ActionDefinition['steps']) => {
    for (const step of steps) {
      out.push(step);
      if (step.type === 'ForStep') visit(step.steps);
    }
  };
  visit(action.steps);
  return out;
}
