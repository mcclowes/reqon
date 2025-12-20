import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { SyncCheckpoint } from './state.js';
import { EPOCH } from './state.js';

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
    await this.ensureDirectory();
    await this.load();
  }

  private async ensureDirectory(): Promise<void> {
    const dir = dirname(this.filePath);
    try {
      await access(dir);
    } catch {
      await mkdir(dir, { recursive: true });
    }
  }

  private async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, SyncCheckpoint>;

      for (const [key, checkpoint] of Object.entries(data)) {
        // Restore Date objects
        checkpoint.syncedAt = new Date(checkpoint.syncedAt);
        this.checkpoints.set(key, checkpoint);
      }
    } catch {
      // Start fresh if file doesn't exist or is corrupted
      this.checkpoints = new Map();
    }
  }

  private async persist(): Promise<void> {
    const data: Record<string, SyncCheckpoint> = {};
    for (const [key, checkpoint] of this.checkpoints) {
      data[key] = checkpoint;
    }
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
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
    this.checkpoints.set(checkpoint.key, checkpoint);
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
    this.checkpoints.set(checkpoint.key, { ...checkpoint });
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
