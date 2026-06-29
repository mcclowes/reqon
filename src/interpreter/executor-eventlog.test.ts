import { describe, it, expect } from 'vitest';
import { MissionExecutor } from './executor.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import type { ReqonProgram, MissionDefinition, ActionStep } from '../ast/nodes.js';

/** A minimal one-action, two-step mission (no I/O). */
function program(): ReqonProgram {
  const letStep = (name: string): ActionStep =>
    ({
      type: 'LetStep',
      name,
      value: { type: 'Literal', value: 1, dataType: 'number' },
    }) as unknown as ActionStep;

  return {
    type: 'ReqonProgram',
    statements: [
      {
        type: 'MissionDefinition',
        name: 'Logged',
        sources: [],
        stores: [],
        schemas: [],
        transforms: [],
        actions: [{ type: 'ActionDefinition', name: 'A', steps: [letStep('x'), letStep('y')] }],
        pipeline: { type: 'PipelineDefinition', stages: [{ action: 'A' }] },
      } as unknown as MissionDefinition,
    ],
  };
}

describe('executor emits an execution event log', () => {
  it('records mission start, each step, and completion in order', async () => {
    const log = new MemoryExecutionLog();
    const result = await new MissionExecutor({ executionLog: log }).execute(program());

    expect(result.success).toBe(true);
    const events = await log.read(result.executionId!);

    expect(events.map((e) => e.type)).toEqual([
      'mission.started',
      'step.started',
      'step.completed',
      'step.started',
      'step.completed',
      'mission.completed',
    ]);
    // Step ids are stable: action + per-action step index.
    const started = events.filter((e) => e.type === 'step.started') as Array<{ stepId: string }>;
    expect(started.map((e) => e.stepId)).toEqual(['A#0', 'A#1']);
  });

  it('records mission.failed with the error when a step throws', async () => {
    const log = new MemoryExecutionLog();
    const badProgram = program();
    // Point the only action's first step at a store that doesn't exist.
    (badProgram.statements[0] as MissionDefinition).actions[0].steps = [
      {
        type: 'StoreStep',
        target: 'missing',
        source: { type: 'Literal', value: { id: 'a' }, dataType: 'object' },
        options: { key: { type: 'Identifier', name: 'id' } },
      } as unknown as ActionStep,
    ];

    const result = await new MissionExecutor({ executionLog: log }).execute(badProgram);

    expect(result.success).toBe(false);
    const types = (await log.read(result.executionId!)).map((e) => e.type);
    expect(types).toContain('mission.failed');
    expect(types).not.toContain('mission.completed');
  });

  it('is a no-op when no execution log is configured', async () => {
    const result = await new MissionExecutor().execute(program());
    expect(result.success).toBe(true);
  });
});
