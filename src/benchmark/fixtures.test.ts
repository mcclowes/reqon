import { describe, it, expect } from 'vitest';
import { parse, execute } from '../index.js';
import type { MissionDefinition } from '../ast/nodes.js';
import { MemoryStore } from '../stores/memory.js';

function missionsOf(dsl: string): MissionDefinition[] {
  return parse(dsl).statements.filter(
    (s): s is MissionDefinition => s.type === 'MissionDefinition'
  );
}
import {
  SIMPLE_DSL,
  MEDIUM_DSL,
  COMPLEX_DSL,
  EXPRESSION_HEAVY_DSL,
  DEEPLY_NESTED_EXPRESSIONS,
  MATCH_HEAVY_DSL,
  ALL_FIXTURES,
  generateLargeDSL,
} from './fixtures.js';
import { STORE_ONLY_DSL, COMPLEX_STORE_DSL } from './e2e.bench.js';

/**
 * The benchmark fixtures are the only consumer of the DSL that no unit test
 * covered, which is exactly why they drifted into a syntax the parser never
 * accepted (see issue #278). These tests parse every fixture so a fixture can't
 * silently rot again, and execute the store-only ones the e2e suite runs.
 */

describe('benchmark fixtures parse under the real grammar', () => {
  const namedFixtures: Array<[string, string]> = [
    ['SIMPLE_DSL', SIMPLE_DSL],
    ['MEDIUM_DSL', MEDIUM_DSL],
    ['COMPLEX_DSL', COMPLEX_DSL],
    ['EXPRESSION_HEAVY_DSL', EXPRESSION_HEAVY_DSL],
    ['DEEPLY_NESTED_EXPRESSIONS', DEEPLY_NESTED_EXPRESSIONS],
    ['MATCH_HEAVY_DSL', MATCH_HEAVY_DSL],
    ['STORE_ONLY_DSL', STORE_ONLY_DSL],
    ['COMPLEX_STORE_DSL', COMPLEX_STORE_DSL],
  ];

  it.each(namedFixtures)('parses %s to at least one mission', (_name, dsl) => {
    expect(missionsOf(dsl).length).toBeGreaterThan(0);
  });

  it('exposes every ALL_FIXTURES entry and each parses', () => {
    for (const dsl of Object.values(ALL_FIXTURES)) {
      expect(() => parse(dsl)).not.toThrow();
    }
  });

  it.each([1, 5, 20, 50])('parses generateLargeDSL(%i)', (count) => {
    const missions = missionsOf(generateLargeDSL(count));
    expect(missions.length).toBe(1);
    // One action per requested count, all wired into the run sequence.
    expect(missions[0].actions.length).toBe(count);
  });
});

describe('store-only benchmark fixtures execute against pre-populated stores', () => {
  it('runs STORE_ONLY_DSL over an input store', async () => {
    const input = new MemoryStore('input');
    await input.set('user-1', {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      value: 10,
      tier: 'A',
      active: true,
    });
    const output = new MemoryStore('output');

    const result = await execute(STORE_ONLY_DSL, {
      dryRun: true,
      stores: { input, output },
    });

    expect(result.success).toBe(true);
  });

  it('runs COMPLEX_STORE_DSL over users and orders', async () => {
    const users = new MemoryStore('users');
    await users.set('user-1', {
      id: 'user-1',
      firstName: 'Grace',
      lastName: 'Hopper',
      score: 95,
      age: 40,
      active: true,
      verified: true,
    });
    const orders = new MemoryStore('orders');
    await orders.set('order-1', {
      id: 'order-1',
      userId: 'user-1',
      amount: 100,
      status: 'completed',
    });
    const reports = new MemoryStore('reports');

    const result = await execute(COMPLEX_STORE_DSL, {
      dryRun: true,
      stores: { users, orders, reports },
    });

    expect(result.success).toBe(true);
  });
});
