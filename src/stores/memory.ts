import type { StoreAdapter, StoreFilter } from './types.js';

export class MemoryStore implements StoreAdapter {
  private data: Map<string, Record<string, unknown>> = new Map();
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    this.data.set(key, { ...value });
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    const existing = this.data.get(key);
    if (existing) {
      this.data.set(key, { ...existing, ...value });
    } else {
      this.data.set(key, value as Record<string, unknown>);
    }
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(filter?: StoreFilter): Promise<Record<string, unknown>[]> {
    let results = Array.from(this.data.values());

    if (filter?.where) {
      results = results.filter((item) => {
        for (const [key, value] of Object.entries(filter.where!)) {
          if (item[key] !== value) return false;
        }
        return true;
      });
    }

    if (filter?.offset) {
      results = results.slice(filter.offset);
    }

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  // For debugging
  size(): number {
    return this.data.size;
  }

  dump(): Record<string, unknown>[] {
    return Array.from(this.data.values());
  }
}
