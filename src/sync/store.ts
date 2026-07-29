import { join } from 'node:path';
import type { SyncCheckpoint } from './state.js';
import { EPOCH } from './state.js';
import { ensureParentDirectory, writeJsonFile, readJsonFile, restoreDates } from '../utils/file.js';

/**
 * A sync watermark is monotonic by definition, so a checkpoint may never move
 * `syncedAt` backwards (#257). Reordered pages, a backdated record (an import or
 * correction), or clock skew between API shards can all produce a candidate
 * older than the current watermark; clamp it so an incremental sync can't rewind
 * and re-fetch - or, worse, under a `set` store, overwrite newer local state
 * with an older version. Enforced here at the store boundary so no caller can
 * bypass it.
 */
export function clampMonotonicSync(
  existing: SyncCheckpoint | undefined,
  candidate: SyncCheckpoint
): SyncCheckpoint {
  if (existing && existing.syncedAt.getTime() > candidate.syncedAt.getTime()) {
    return { ...candidate, syncedAt: existing.syncedAt };
  }
  return candidate;
}

/**
 * Sync store interface - persists sync checkpoints
 */
export interface SyncStore {
  /** Get last sync timestamp for a key */
  getLastSync(key: string): Promise<Date>;

  /** Get checkpoint details for a key */
  getCheckpoint(key: string): Promise<SyncCheckpoint | null>;

  /** Record a successful sync */
  recordSync(checkpoint: SyncCheckpoint): Promise<void>;

  /** List all checkpoints */
  list(): Promise<SyncCheckpoint[]>;

  /** Clear a specific checkpoint */
  clear(key: string): Promise<void>;

  /** Clear all checkpoints */
  clearAll(): Promise<void>;
}

/**
 * File-based sync store
 * Stores sync state in .reqon-data/sync/{mission}.json
 */
export class FileSyncStore implements SyncStore {
  private filePath: string;
  private checkpoints: Map<string, SyncCheckpoint> = new Map();
  private initialized: Promise<void>;

  constructor(mission: string, baseDir = '.reqon-data/sync') {
    this.filePath = join(baseDir, `${mission}.json`);
    this.initialized = this.init();
  }

  private async init(): Promise<void> {
    await ensureParentDirectory(this.filePath);
    await this.load();
  }

  private async load(): Promise<void> {
    const data = await readJsonFile<Record<string, SyncCheckpoint>>(this.filePath);
    if (data) {
      for (const [key, checkpoint] of Object.entries(data)) {
        // Restore Date objects
        restoreDates(checkpoint as unknown as Record<string, unknown>, ['syncedAt']);
        this.checkpoints.set(key, checkpoint);
      }
    } else {
      this.checkpoints = new Map();
    }
  }

  private async persist(): Promise<void> {
    const data: Record<string, SyncCheckpoint> = {};
    for (const [key, checkpoint] of this.checkpoints) {
      data[key] = checkpoint;
    }
    await writeJsonFile(this.filePath, data);
  }

  async getLastSync(key: string): Promise<Date> {
    await this.initialized;
    const checkpoint = this.checkpoints.get(key);
    return checkpoint?.syncedAt ?? EPOCH;
  }

  async getCheckpoint(key: string): Promise<SyncCheckpoint | null> {
    await this.initialized;
    return this.checkpoints.get(key) ?? null;
  }

  async recordSync(checkpoint: SyncCheckpoint): Promise<void> {
    await this.initialized;
    const clamped = clampMonotonicSync(this.checkpoints.get(checkpoint.key), checkpoint);
    this.checkpoints.set(clamped.key, clamped);
    await this.persist();
  }

  async list(): Promise<SyncCheckpoint[]> {
    await this.initialized;
    return Array.from(this.checkpoints.values());
  }

  async clear(key: string): Promise<void> {
    await this.initialized;
    this.checkpoints.delete(key);
    await this.persist();
  }

  async clearAll(): Promise<void> {
    await this.initialized;
    this.checkpoints.clear();
    await this.persist();
  }
}

/**
 * In-memory sync store (for testing)
 */
export class MemorySyncStore implements SyncStore {
  private checkpoints: Map<string, SyncCheckpoint> = new Map();

  async getLastSync(key: string): Promise<Date> {
    const checkpoint = this.checkpoints.get(key);
    return checkpoint?.syncedAt ?? EPOCH;
  }

  async getCheckpoint(key: string): Promise<SyncCheckpoint | null> {
    return this.checkpoints.get(key) ?? null;
  }

  async recordSync(checkpoint: SyncCheckpoint): Promise<void> {
    const clamped = clampMonotonicSync(this.checkpoints.get(checkpoint.key), checkpoint);
    this.checkpoints.set(clamped.key, { ...clamped });
  }

  async list(): Promise<SyncCheckpoint[]> {
    return Array.from(this.checkpoints.values());
  }

  async clear(key: string): Promise<void> {
    this.checkpoints.delete(key);
  }

  async clearAll(): Promise<void> {
    this.checkpoints.clear();
  }
}
