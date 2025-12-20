export interface StoreAdapter {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  update(key: string, value: Partial<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
  list(filter?: StoreFilter): Promise<Record<string, unknown>[]>;
  clear(): Promise<void>;
}

export interface StoreFilter {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface StoreConfig {
  type: 'nosql' | 'sql' | 'memory';
  target: string;
  connection?: string;
}
