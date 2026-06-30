import { describe, it, expect } from 'vitest';
import { foldLog } from './fold.js';
import { MemoryExecutionLog } from './store.js';
import { effectId } from './events.js';

describe('foldLog', () => {
  it('reconstructs status, completed steps, applied effects and checkpoints', async () => {
    const log = new MemoryExecutionLog();
    const e = 'run-1';
    const fx = effectId(e, 's0', 0, 'store', 'rec-1');

    await log.append({ executionId: e, type: 'mission.started', mission: 'M' });
    await log.append({
      executionId: e,
      type: 'step.started',
      stepId: 's0',
      action: 'A',
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
    await log.append({ executionId: e, type: 'checkpoint.advanced', key: 'ck', syncedAt: 'T' });
    await log.append({ executionId: e, type: 'mission.completed' });

    const state = foldLog(await log.read(e));

    expect(state.status).toBe('completed');
    expect(state.lastSeq).toBe(5);
    expect(state.completedSteps.has('s0')).toBe(true);
    expect(state.appliedEffects.has(fx)).toBe(true);
    expect(state.checkpoints.get('ck')).toBe('T');
  });

  it('reflects a paused run and the pause it is waiting on', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'p', type: 'mission.started', mission: 'M' });
    await log.append({ executionId: 'p', type: 'pause.created', pauseId: 'pause-1' });

    const state = foldLog(await log.read('p'));
    expect(state.status).toBe('paused');
    expect(state.pendingPauseId).toBe('pause-1');
  });

  it('clears the pending pause once resumed', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'p', type: 'mission.started', mission: 'M' });
    await log.append({ executionId: 'p', type: 'pause.created', pauseId: 'pause-1' });
    await log.append({
      executionId: 'p',
      type: 'pause.resumed',
      pauseId: 'pause-1',
      resumedBy: 'timeout',
    });

    const state = foldLog(await log.read('p'));
    expect(state.status).toBe('running');
    expect(state.pendingPauseId).toBeUndefined();
  });

  it('an empty log folds to a pending run', () => {
    const state = foldLog([]);
    expect(state.status).toBe('pending');
    expect(state.lastSeq).toBe(-1);
  });

  it('tracks the latest page progress per backfill step', async () => {
    const log = new MemoryExecutionLog();
    const e = 'bf';
    await log.append({ executionId: e, type: 'mission.started', mission: 'M' });
    await log.append({
      executionId: e,
      type: 'page.completed',
      stepId: 'Backfill#0',
      page: 1,
      cursor: 'c1',
      recordCount: 50,
      done: false,
    });
    await log.append({
      executionId: e,
      type: 'page.completed',
      stepId: 'Backfill#0',
      page: 2,
      cursor: 'c2',
      recordCount: 50,
      done: false,
    });

    const state = foldLog(await log.read(e));
    expect(state.pageProgress.get('Backfill#0')).toEqual({ page: 2, cursor: 'c2', done: false });
  });
});
