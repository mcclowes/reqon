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
  /** Write mode: 'immediate' writes on every change, 'batch' only on flush/close */
  persist?: 'immediate' | 'batch';
  /** Pretty-print JSON for readability (default: true) */
  pretty?: boolean;
}

const DEFAULT_OPTIONS: Required<FileStoreOptions> = {
  baseDir: '.reqon-data',
  persist: 'immediate',
  pretty: true,
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
    await this.writeToDisk();
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

  async clear(): Promise<void> {
    await this.initialized;
    this.data.clear();
    await this.persist();
  }

  /**
   * Flush pending changes to disk (only needed in 'batch' mode)
   * Uses synchronous I/O to ensure data is written before process exits
   */
  flush(): void {
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
