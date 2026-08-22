import { describe, it, expect } from 'vitest';
import { MemoryExecutionLog } from './store.js';

describe('MemoryExecutionLog', () => {
  it('appends events and reads them back in order with contiguous seq', async () => {
    const log = new MemoryExecutionLog();

    await log.append({ executionId: 'e1', type: 'mission.started', mission: 'M' });
    await log.append({ executionId: 'e1', type: 'step.completed', stepId: 's0', attempt: 0 });

    const events = await log.read('e1');
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
    expect(events.map((e) => e.type)).toEqual(['mission.started', 'step.completed']);
    expect(events[0].at).toBeTypeOf('string');
  });

  it('keeps executions isolated', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'a', type: 'mission.started', mission: 'A' });
    await log.append({ executionId: 'b', type: 'mission.started', mission: 'B' });

    expect(await log.read('a')).toHaveLength(1);
    expect((await log.read('b'))[0].seq).toBe(0);
  });

  it('returns a copy so reads cannot mutate the log', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'e', type: 'mission.started', mission: 'M' });
    const first = await log.read('e');
    first.push({} as never);
    expect(await log.read('e')).toHaveLength(1);
  });

  describe('listCheckpoints', () => {
    it('returns the latest checkpoint per key across executions', async () => {
      const log = new MemoryExecutionLog();
      // Run 1 advances key "inv" to T1.
      await log.append({ executionId: 'r1', type: 'mission.started', mission: 'M' });
      await log.append({
        executionId: 'r1',
        type: 'checkpoint.advanced',
        key: 'inv',
        syncedAt: '2026-01-01T00:00:00.000Z',
        recordCount: 5,
        mission: 'M',
      });
      // Run 2 advances the same key to a later time, plus a second key.
      await log.append({ executionId: 'r2', type: 'mission.started', mission: 'M' });
      await log.append({
        executionId: 'r2',
        type: 'checkpoint.advanced',
        key: 'inv',
        syncedAt: '2026-02-01T00:00:00.000Z',
        recordCount: 3,
        cursor: 'page-7',
        mission: 'M',
      });
      await log.append({
        executionId: 'r2',
        type: 'checkpoint.advanced',
        key: 'contacts',
        syncedAt: '2026-02-01T00:00:00.000Z',
        mission: 'M',
      });

      const checkpoints = await log.listCheckpoints();
      const byKey = new Map(checkpoints.map((c) => [c.key, c]));

      expect(byKey.get('inv')?.syncedAt).toBe('2026-02-01T00:00:00.000Z');
      expect(byKey.get('inv')?.cursor).toBe('page-7');
      expect(byKey.get('inv')?.executionId).toBe('r2');
      expect(byKey.get('contacts')?.syncedAt).toBe('2026-02-01T00:00:00.000Z');
    });

    it('ignores non-checkpoint events', async () => {
      const log = new MemoryExecutionLog();
      await log.append({ executionId: 'e', type: 'mission.started', mission: 'M' });
      expect(await log.listCheckpoints()).toHaveLength(0);
    });

    it('filters by mission when one is given', async () => {
      const log = new MemoryExecutionLog();
      await log.append({
        executionId: 'a',
        type: 'checkpoint.advanced',
        key: 'k',
        syncedAt: '2026-01-01T00:00:00.000Z',
        mission: 'A',
      });
      await log.append({
        executionId: 'b',
        type: 'checkpoint.advanced',
        key: 'k',
        syncedAt: '2026-03-01T00:00:00.000Z',
        mission: 'B',
      });

      const onlyA = await log.listCheckpoints('A');
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0].syncedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('listPauses', () => {
    it('returns every pause.created and pause.resumed event across executions', async () => {
      const log = new MemoryExecutionLog();
      await log.append({ executionId: 'a', type: 'mission.started', mission: 'M' });
      await log.append({
        executionId: 'a',
        type: 'pause.created',
        pauseId: 'p1',
        pause: { id: 'p1' },
      });
      await log.append({
        executionId: 'b',
        type: 'pause.created',
        pauseId: 'p2',
        pause: { id: 'p2' },
      });
      await log.append({
        executionId: 'b',
        type: 'pause.resumed',
        pauseId: 'p2',
        resumedBy: 'timeout',
      });

      const pauses = await log.listPauses();
      expect(pauses.map((e) => e.type).sort()).toEqual([
        'pause.created',
        'pause.created',
        'pause.resumed',
      ]);
    });
  });
});
