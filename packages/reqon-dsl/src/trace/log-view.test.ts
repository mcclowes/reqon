import { describe, it, expect } from 'vitest';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { effectId } from '../execution-log/index.js';
import { LogTraceView, traceTimelineFromLog } from './log-view.js';

async function seedRun(log: MemoryExecutionLog, e = 'run-1') {
  const fx = effectId(e, 's0', 0, 'store', 'rec-1');
  await log.append({ executionId: e, type: 'mission.started', mission: 'M' });
  await log.append({
    executionId: e,
    type: 'step.started',
    stepId: 's0',
    action: 'Pull',
    stepType: 'store',
    attempt: 0,
  });
  await log.append({
    executionId: e,
    type: 'effect.applied',
    stepId: 's0',
    attempt: 0,
    effectType: 'store',
    effectId: fx,
  });
  await log.append({ executionId: e, type: 'step.completed', stepId: 's0', attempt: 0 });
  await log.append({ executionId: e, type: 'mission.completed' });
  return e;
}

describe('traceTimelineFromLog', () => {
  it('builds an ordered timeline from the log events', async () => {
    const log = new MemoryExecutionLog();
    await seedRun(log);

    const timeline = traceTimelineFromLog(await log.read('run-1'));

    expect(timeline.map((t) => t.type)).toEqual([
      'mission.started',
      'step.started',
      'effect.applied',
      'step.completed',
      'mission.completed',
    ]);
    // Steps carry their action and step identity for navigation.
    const started = timeline.find((t) => t.type === 'step.started');
    expect(started?.action).toBe('Pull');
    expect(started?.step).toBe('s0');
    expect(started?.seq).toBe(1);
  });

  it('summarises an error from a failed run', () => {
    const timeline = traceTimelineFromLog([
      { executionId: 'x', type: 'mission.started', mission: 'M', seq: 0, at: 'T0' },
      { executionId: 'x', type: 'mission.failed', error: 'boom', seq: 1, at: 'T1' },
    ]);
    const failed = timeline.find((t) => t.type === 'mission.failed');
    expect(failed?.detail).toContain('boom');
  });
});

describe('LogTraceView', () => {
  it('reads the timeline and a folded summary for an execution', async () => {
    const log = new MemoryExecutionLog();
    await seedRun(log);
    const view = new LogTraceView(log, 'run-1');

    expect(await view.timeline()).toHaveLength(5);

    const summary = await view.summary();
    expect(summary.status).toBe('completed');
    expect(summary.stepsCompleted).toBe(1);
    expect(summary.effectsApplied).toBe(1);
    expect(summary.totalEvents).toBe(5);
  });

  it('reports a paused run as waiting on its pending pause', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'p', type: 'mission.started', mission: 'M' });
    await log.append({ executionId: 'p', type: 'pause.created', pauseId: 'pause-1' });
    const view = new LogTraceView(log, 'p');

    const summary = await view.summary();
    expect(summary.status).toBe('paused');
    expect(summary.pendingPauseId).toBe('pause-1');
  });
});
