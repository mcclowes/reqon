import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
