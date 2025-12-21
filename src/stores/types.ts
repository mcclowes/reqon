export interface StoreAdapter {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  update(key: string, value: Partial<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
  list(filter?: StoreFilter): Promise<Record<string, unknown>[]>;
  count(filter?: StoreFilter): Promise<number>;
  clear(): Promise<void>;
}

export interface StoreFilter {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface StoreConfig {
  type: 'nosql' | 'sql' | 'memory' | 'file';
  target: string;
  connection?: string;
  /** For file stores: 'json' or 'csv' */
  format?: 'json' | 'csv';
}

/**
 * Apply filter criteria to a list of records.
 * Handles where clause, offset, and limit.
 */
export function applyStoreFilter<T extends Record<string, unknown>>(
  records: T[],
  filter?: StoreFilter
): T[] {
  if (!filter) return records;

  let results = records;

  if (filter.where) {
    const whereClause = filter.where;
    results = results.filter((item) => {
      for (const [key, value] of Object.entries(whereClause)) {
        if (item[key] !== value) return false;
      }
      return true;
    });
  }

  if (filter.offset) {
    results = results.slice(filter.offset);
  }

  if (filter.limit) {
    results = results.slice(0, filter.limit);
  }

  return results;
}
