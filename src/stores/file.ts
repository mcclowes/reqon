import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { StoreAdapter, StoreFilter } from './types.js';
import { applyStoreFilter } from './types.js';

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

  constructor(name: string, options: FileStoreOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.filePath = join(this.options.baseDir, `${name}.json`);
    this.ensureDirectory();
    this.load();
  }

  private ensureDirectory(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      // Create .gitignore if it doesn't exist
      const gitignorePath = join(dir, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, '# Reqon local data\n*.json\n');
      }
    }
  }

  private load(): void {
    if (existsSync(this.filePath)) {
      try {
        const content = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, Record<string, unknown>>;
        this.data = new Map(Object.entries(parsed));
      } catch {
        // If file is corrupted, start fresh
        this.data = new Map();
      }
    }
  }

  private persist(): void {
    if (this.options.persist === 'batch') {
      this.dirty = true;
      return;
    }
    this.writeToDisk();
  }

  private writeToDisk(): void {
    const obj = Object.fromEntries(this.data);
    const content = this.options.pretty
      ? JSON.stringify(obj, null, 2)
      : JSON.stringify(obj);
    writeFileSync(this.filePath, content, 'utf-8');
    this.dirty = false;
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    this.data.set(key, { ...value });
    this.persist();
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    const existing = this.data.get(key);
    if (existing) {
      this.data.set(key, { ...existing, ...value });
    } else {
      this.data.set(key, value as Record<string, unknown>);
    }
    this.persist();
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
    this.persist();
  }

  async list(filter?: StoreFilter): Promise<Record<string, unknown>[]> {
    return applyStoreFilter(Array.from(this.data.values()), filter);
  }

  async clear(): Promise<void> {
    this.data.clear();
    this.persist();
  }

  /**
   * Flush pending changes to disk (only needed in 'batch' mode)
   */
  flush(): void {
    if (this.dirty) {
      this.writeToDisk();
    }
  }

  /**
   * Reload data from disk (useful if file was modified externally)
   */
  reload(): void {
    this.load();
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
