import { writeFile } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { StoreAdapter, StoreFilter } from './types.js';
import { applyStoreFilter } from './types.js';
import {
  ensureDirectory,
  readJsonFile,
  serialize,
} from '../utils/file.js';

export interface FileStoreOptions {
  /** Base directory for data files (default: '.reqon-data') */
  baseDir?: string;
  /** Write mode: 'immediate' writes on every change, 'batch' only on flush/close, 'debounce' batches writes */
  persist?: 'immediate' | 'batch' | 'debounce';
  /** Pretty-print JSON for readability (default: true) */
  pretty?: boolean;
  /** Debounce delay in milliseconds (default: 100ms, only used with persist: 'debounce') */
  debounceMs?: number;
}

const DEFAULT_OPTIONS: Required<FileStoreOptions> = {
  baseDir: '.reqon-data',
  persist: 'immediate',
  pretty: true,
  debounceMs: 100,
};

/**
 * File-based JSON store for local development
 * Persists data to .reqon-data/{name}.json
 */
export class FileStore implements StoreAdapter {
  private data: Map<string, Record<string, unknown>> = new Map();
  private filePath: string;
  private options: Required<FileStoreOptions>;
  private dirty = false;
  private initialized: Promise<void>;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite: Promise<void> | null = null;

  constructor(name: string, options: FileStoreOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.filePath = join(this.options.baseDir, `${name}.json`);
    this.initialized = this.init();
  }

  private async init(): Promise<void> {
    const dir = dirname(this.filePath);
    await ensureDirectory(dir);
    // Create .gitignore if it doesn't exist
    const gitignorePath = join(dir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await writeFile(gitignorePath, '# Reqon local data\n*.json\n', 'utf-8');
    }
    await this.load();
  }

  private async load(): Promise<void> {
    const parsed = await readJsonFile<Record<string, Record<string, unknown>>>(this.filePath);
    if (parsed) {
      this.data = new Map(Object.entries(parsed));
    }
  }

  private async persist(): Promise<void> {
    if (this.options.persist === 'batch') {
      this.dirty = true;
      return;
    }
    if (this.options.persist === 'debounce') {
      this.dirty = true;
      this.scheduleDebouncedWrite();
      return;
    }
    await this.writeToDisk();
  }

  private scheduleDebouncedWrite(): void {
    // Clear existing timer if any
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    // Schedule new write
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.dirty && !this.pendingWrite) {
        this.pendingWrite = this.writeToDisk().finally(() => {
          this.pendingWrite = null;
        });
      }
    }, this.options.debounceMs);
  }

  private async writeToDisk(): Promise<void> {
    const obj = Object.fromEntries(this.data);
    const content = serialize(obj, this.options.pretty);
    await writeFile(this.filePath, content, 'utf-8');
    this.dirty = false;
  }

  /** Synchronous write for flush/close operations */
  private writeToDiskSync(): void {
    const obj = Object.fromEntries(this.data);
    const content = serialize(obj, this.options.pretty);
    writeFileSync(this.filePath, content, 'utf-8');
    this.dirty = false;
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    await this.initialized;
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    await this.initialized;
    this.data.set(key, { ...value });
    await this.persist();
  }

  async bulkSet(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void> {
    await this.initialized;
    // Set all records in memory first (no disk I/O per record)
    for (const { key, value } of records) {
      this.data.set(key, { ...value });
    }
    // Single persist operation for all records
    await this.persist();
  }

  async bulkUpsert(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void> {
    await this.initialized;
    // Upsert all records in memory first (no disk I/O per record)
    for (const { key, value } of records) {
      const existing = this.data.get(key);
      if (existing) {
        this.data.set(key, { ...existing, ...value });
      } else {
        this.data.set(key, { ...value });
      }
    }
    // Single persist operation for all records
    await this.persist();
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    await this.initialized;
    const existing = this.data.get(key);
    if (existing) {
      this.data.set(key, { ...existing, ...value });
    } else {
      this.data.set(key, value as Record<string, unknown>);
    }
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.initialized;
    this.data.delete(key);
    await this.persist();
  }

  async list(filter?: StoreFilter): Promise<Record<string, unknown>[]> {
    await this.initialized;
    return applyStoreFilter(Array.from(this.data.values()), filter);
  }

  async count(filter?: StoreFilter): Promise<number> {
    await this.initialized;
    // Apply only the where clause for counting (ignore limit/offset)
    const filtered = applyStoreFilter(Array.from(this.data.values()), {
      where: filter?.where,
    });
    return filtered.length;
  }

  async clear(): Promise<void> {
    await this.initialized;
    this.data.clear();
    await this.persist();
  }

  /**
   * Flush pending changes to disk (needed in 'batch' or 'debounce' mode)
   * Uses synchronous I/O to ensure data is written before process exits
   */
  flush(): void {
    // Cancel any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dirty) {
      this.writeToDiskSync();
    }
  }

  /**
   * Close the store, ensuring all pending changes are written to disk.
   * Should be called before the process exits to prevent data loss in batch mode.
   */
  close(): void {
    this.flush();
  }

  /**
   * Reload data from disk (useful if file was modified externally)
   */
  async reload(): Promise<void> {
    await this.load();
  }

  // For debugging
  size(): number {
    return this.data.size;
  }

  dump(): Record<string, unknown>[] {
    return Array.from(this.data.values());
  }

  getFilePath(): string {
    return this.filePath;
  }
}
