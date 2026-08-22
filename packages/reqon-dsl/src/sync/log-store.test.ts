import { describe, it, expect } from 'vitest';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { LogBackedSyncStore } from './log-store.js';
import { EPOCH } from './state.js';

describe('LogBackedSyncStore', () => {
  it('derives the last sync time from checkpoint.advanced events in the log', async () => {
    const log = new MemoryExecutionLog();
    await log.append({
      executionId: 'r1',
      type: 'checkpoint.advanced',
      key: 'inv',
      syncedAt: '2026-01-01T00:00:00.000Z',
      mission: 'M',
    });
    const store = new LogBackedSyncStore(log, 'M');

    expect((await store.getLastSync('inv')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns EPOCH for an unknown key (a fresh sync)', async () => {
    const store = new LogBackedSyncStore(new MemoryExecutionLog(), 'M');
    expect(await store.getLastSync('never-synced')).toEqual(EPOCH);
  });

  it('exposes the full checkpoint including cursor and record count', async () => {
    const log = new MemoryExecutionLog();
    await log.append({
      executionId: 'r1',
      type: 'checkpoint.advanced',
      key: 'inv',
      syncedAt: '2026-01-01T00:00:00.000Z',
      recordCount: 12,
      cursor: 'page-3',
      mission: 'M',
    });
    const store = new LogBackedSyncStore(log, 'M');

    const cp = await store.getCheckpoint('inv');
    expect(cp?.recordCount).toBe(12);
    expect(cp?.cursor).toBe('page-3');
    expect(cp?.syncedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('only sees checkpoints from its own mission in a shared log', async () => {
    const log = new MemoryExecutionLog();
    await log.append({
      executionId: 'a',
      type: 'checkpoint.advanced',
      key: 'inv',
      syncedAt: '2026-05-01T00:00:00.000Z',
      mission: 'Other',
    });
    const store = new LogBackedSyncStore(log, 'M');
    expect(await store.getLastSync('inv')).toEqual(EPOCH);
  });

  it('recordSync is a no-op — the log is the source of truth', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedSyncStore(log, 'M');
    await store.recordSync({ key: 'inv', syncedAt: new Date() });
    expect(await log.read('any')).toHaveLength(0);
    expect(await store.getLastSync('inv')).toEqual(EPOCH);
  });
});
