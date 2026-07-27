import { describe, it, expect } from 'vitest';
import { parse, execute } from '../index.js';
import { MemoryStore } from '../stores/memory.js';
import { ALL_FIXTURES, STORE_ONLY_DSL, generateLargeDSL } from './fixtures.js';

/**
 * The benchmarks are the only consumer of this DSL, and `npm run bench` runs
 * outside the PR gate. Without these tests a fixture drifts from the grammar
 * and nothing notices until the benchmark job has been red for weeks.
 */
describe('benchmark fixtures', () => {
  it.each(Object.entries(ALL_FIXTURES))('%s parses into a mission', (_name, dsl) => {
    const program = parse(dsl);

    expect(program.statements).toHaveLength(1);
    const mission = program.statements[0];
    expect(mission.type).toBe('MissionDefinition');
    if (mission.type === 'MissionDefinition') {
      expect(mission.actions.length).toBeGreaterThan(0);
    }
  });

  it.each([1, 10, 50])('generateLargeDSL(%i) parses with that many actions', (count) => {
    const program = parse(generateLargeDSL(count));

    const mission = program.statements[0];
    expect(mission.type).toBe('MissionDefinition');
    if (mission.type === 'MissionDefinition') {
      expect(mission.actions).toHaveLength(count);
      expect(mission.stores).toHaveLength(count);
    }
  });

  it('executes the store-processing fixture the e2e benchmark runs', async () => {
    const input = new MemoryStore('input');
    await input.set('user-1', {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'L',
      value: 3,
      tier: 'A',
      active: true,
    });

    const output = new MemoryStore('output');
    // No source and no fetch, so this touches nothing outside the process.
    await execute(STORE_ONLY_DSL, { stores: { input, output } });

    expect(await output.get('user-1')).toMatchObject({ id: 'user-1', fullName: 'Ada L', score: 6 });
  });
});
