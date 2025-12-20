import type { StoreAdapter } from './types.js';
import { MemoryStore } from './memory.js';
import { FileStore, type FileStoreOptions } from './file.js';

export type StoreType = 'memory' | 'file' | 'sql' | 'nosql';

export interface CreateStoreOptions {
  /** Store type */
  type: StoreType;
  /** Store/collection name */
  name: string;
  /** Base directory for file stores (default: '.reqon-data') */
  baseDir?: string;
  /** File store options */
  fileOptions?: FileStoreOptions;
}

/**
 * Create a store adapter based on type
 *
 * For local development:
 * - 'memory' - In-memory, lost on restart (good for tests)
 * - 'file' - JSON files in .reqon-data/ (good for local dev)
 *
 * For production (not yet implemented):
 * - 'sql' - PostgreSQL/MySQL
 * - 'nosql' - MongoDB/DynamoDB
 */
export function createStore(options: CreateStoreOptions): StoreAdapter {
  switch (options.type) {
    case 'memory':
      return new MemoryStore(options.name);

    case 'file':
      return new FileStore(options.name, {
        ...options.fileOptions,
        baseDir: options.baseDir ?? '.reqon-data',
      });

    case 'sql':
      // TODO: Implement SQL adapter
      console.warn(`SQL store not yet implemented, falling back to file store for '${options.name}'`);
      return new FileStore(options.name, {
        ...options.fileOptions,
        baseDir: options.baseDir ?? '.reqon-data/sql',
      });

    case 'nosql':
      // TODO: Implement NoSQL adapter
      console.warn(`NoSQL store not yet implemented, falling back to file store for '${options.name}'`);
      return new FileStore(options.name, {
        ...options.fileOptions,
        baseDir: options.baseDir ?? '.reqon-data/nosql',
      });

    default:
      throw new Error(`Unknown store type: ${options.type}`);
  }
}

/**
 * Map DSL store type to adapter type
 * In development mode, sql/nosql fall back to file stores
 */
export function resolveStoreType(
  dslType: 'sql' | 'nosql' | 'memory',
  developmentMode = true
): StoreType {
  if (dslType === 'memory') {
    return 'memory';
  }

  if (developmentMode) {
    // Use file stores for local development
    return 'file';
  }

  // In production, use the actual type
  return dslType;
}
