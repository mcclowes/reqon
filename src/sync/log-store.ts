/**
 * Log-backed sync store: incremental-sync checkpoints as a view over the
 * execution log.
 *
 * In durable mode the execution log is the single source of truth — a sync's
 * progress is recorded as a `checkpoint.advanced` event alongside everything
 * else, so it survives a crash and resumes atomically with the run. This
 * adapter reads `getLastSync`/checkpoint state back out of those events
 * (newest-per-key, monotonic by `syncedAt`) instead of a separate sync file.
 *
 * Writes go through the log, not here: the executor appends `checkpoint.advanced`
 * when a sync's fetched data is durably stored, so {@link recordSync} is a no-op.
 */
import type { ExecutionLogStore } from '../execution-log/index.js';
import type { SyncStore } from './store.js';
import type { SyncCheckpoint } from './state.js';
import { EPOCH } from './state.js';

export class LogBackedSyncStore implements SyncStore {
  constructor(
    private log: ExecutionLogStore,
    private mission?: string
  ) {}

  private async checkpoint(key: string): Promise<SyncCheckpoint | null> {
    const records = await this.log.listCheckpoints(this.mission);
    const record = records.find((r) => r.key === key);
    if (!record) return null;
    return {
      key: record.key,
      syncedAt: new Date(record.syncedAt),
      recordCount: record.recordCount,
      cursor: record.cursor,
      mission: record.mission,
      executionId: record.executionId,
    };
  }

  async getLastSync(key: string): Promise<Date> {
    return (await this.checkpoint(key))?.syncedAt ?? EPOCH;
  }

  async getCheckpoint(key: string): Promise<SyncCheckpoint | null> {
    return this.checkpoint(key);
  }

  async list(): Promise<SyncCheckpoint[]> {
    const records = await this.log.listCheckpoints(this.mission);
    return records.map((r) => ({
      key: r.key,
      syncedAt: new Date(r.syncedAt),
      recordCount: r.recordCount,
      cursor: r.cursor,
      mission: r.mission,
      executionId: r.executionId,
    }));
  }

  /** No-op: the log (via `checkpoint.advanced`) is the write path. */
  async recordSync(_checkpoint: SyncCheckpoint): Promise<void> {}

  /** Clearing a log-derived checkpoint isn't supported (the log is append-only). */
  async clear(): Promise<void> {}

  async clearAll(): Promise<void> {}
}
