import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { StoreAdapter, StoreFilter } from './types.js';
import { applyStoreFilter } from './types.js';
import { ensureDirectory, readJsonFile, serialize, writeFileAtomic } from '../utils/file.js';
import { safeJoin } from '../utils/path.js';
import { deepMerge } from '../utils/deep-merge.js';

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
 *
 * Use FileStore.create() for async initialization (recommended),
 * or new FileStore() for lazy initialization (backward compatible).
 */
export class FileStore implements StoreAdapter {
  private data: Map<string, Record<string, unknown>> = new Map();
  private filePath: string;
  private options: Required<FileStoreOptions>;
  private dirty = false;
  private initialized: Promise<void> | null = null;
  private initError: Error | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite: Promise<void> | null = null;
  /** Tail of the write chain; keeps disk writes from overlapping. */
  private writeChain: Promise<void> = Promise.resolve();
  /** A queued write that has not started serialising yet, so it can be shared. */
  private coalescedWrite: Promise<void> | null = null;

  /**
   * Create a FileStore with async initialization (recommended).
   * The store is fully initialized when the promise resolves.
   *
   * @example
   * const store = await FileStore.create('my-store', { baseDir: '.data' });
   */
  static async create(name: string, options: FileStoreOptions = {}): Promise<FileStore> {
    const store = new FileStore(name, options);
    await store.ensureInitialized();
    return store;
  }

  /**
   * Constructor for lazy initialization (backward compatible).
   * Each operation will wait for initialization to complete.
   * Prefer FileStore.create() for explicit async initialization.
   */
  constructor(name: string, options: FileStoreOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.filePath = safeJoin(this.options.baseDir, `${name}.json`);
    // Lazy initialization - init() is called on first operation
  }

  /**
   * Ensure the store is initialized. Safe to call multiple times.
   * Throws if initialization previously failed.
   */
  private async ensureInitialized(): Promise<void> {
    // If init previously failed, throw the cached error
    if (this.initError) {
      throw this.initError;
    }

    // If not yet started, start initialization
    if (this.initialized === null) {
      this.initialized = this.init().catch((error) => {
        this.initError = error instanceof Error ? error : new Error(String(error));
        throw this.initError;
      });
    }

    await this.initialized;
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

  /**
   * Queue a write behind any that are already running.
   *
   * A write serialises the whole map, so concurrent callers must not overlap:
   * two writes started from different states rename over the same target, and
   * whichever lands second wins regardless of which state is newer. Under
   * `for ... concurrency N` that silently drops keys the map still reports as
   * stored.
   *
   * Callers that arrive before a queued write starts serialising share it -
   * their mutation is already in the map, so that write will include it.
   */
  private writeToDisk(): Promise<void> {
    if (this.coalescedWrite) {
      return this.coalescedWrite;
    }

    const write = this.writeChain
      .catch(() => {})
      .then(() => {
        // Cleared before serialising, so anything mutating after this point
        // queues a fresh write rather than assuming this one covers it.
        this.coalescedWrite = null;
        return this.serializeToDisk();
      });

    this.coalescedWrite = write;
    this.writeChain = write.catch(() => {});
    return write;
  }

  private async serializeToDisk(): Promise<void> {
    // Cleared before the snapshot: a mutation landing mid-write re-marks the
    // store dirty instead of being masked when this write completes.
    this.dirty = false;
    const obj = Object.fromEntries(this.data);
    const content = serialize(obj, this.options.pretty);
    await writeFileAtomic(this.filePath, content);
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    await this.ensureInitialized();
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    await this.ensureInitialized();
    this.data.set(key, { ...value });
    await this.persist();
  }

  async bulkSet(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void> {
    await this.ensureInitialized();
    // Set all records in memory first (no disk I/O per record)
    for (const { key, value } of records) {
      this.data.set(key, { ...value });
    }
    // Single persist operation for all records
    await this.persist();
  }

  async bulkUpsert(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void> {
    await this.ensureInitialized();
    // Upsert all records in memory first (no disk I/O per record)
    for (const { key, value } of records) {
      const existing = this.data.get(key);
      this.data.set(key, existing ? deepMerge(existing, value) : { ...value });
    }
    // Single persist operation for all records
    await this.persist();
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    await this.ensureInitialized();
    const existing = this.data.get(key);
    this.data.set(
      key,
      existing ? deepMerge(existing, value as Record<string, unknown>) : { ...value }
    );
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.ensureInitialized();
    this.data.delete(key);
    await this.persist();
  }

  async list(filter?: StoreFilter): Promise<Record<string, unknown>[]> {
    await this.ensureInitialized();
    return applyStoreFilter(Array.from(this.data.values()), filter);
  }

  async count(filter?: StoreFilter): Promise<number> {
    await this.ensureInitialized();
    // Apply only the where clause for counting (ignore limit/offset)
    const filtered = applyStoreFilter(Array.from(this.data.values()), {
      where: filter?.where,
    });
    return filtered.length;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.data.clear();
    await this.persist();
  }

  /**
   * Flush pending changes to disk (needed in 'batch' or 'debounce' mode).
   *
   * Quiesces the async write chain before writing: a synchronous write here
   * would jump the queue, and an in-flight write finishing later would rename
   * older data over the newer state.
   */
  async flush(): Promise<void> {
    // Cancel any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Nothing was ever written if init never ran or failed.
    if (this.initialized === null) return;
    await this.initialized.catch(() => {});
    if (this.initError) return;
    // Writes queued behind us may extend the chain while we drain it.
    let tail;
    do {
      tail = this.writeChain;
      await tail;
    } while (tail !== this.writeChain);
    if (this.dirty) {
      await this.writeToDisk();
    }
  }

  /**
   * Close the store, ensuring all pending changes are durably on disk (#259).
   * Should be awaited before the process exits to prevent data loss.
   */
  async close(): Promise<void> {
    await this.flush();
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
