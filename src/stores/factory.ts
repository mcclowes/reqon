import type { StoreAdapter } from './types.js';
import { MemoryStore } from './memory.js';
import { FileStore, type FileStoreOptions } from './file.js';
import { PostgRESTStore, type PostgRESTOptions } from './postgrest.js';
import { type Logger, createLogger } from '../utils/logger.js';

export type StoreType = 'memory' | 'file' | 'sql' | 'nosql' | 'postgrest';

export interface CreateStoreOptions {
  /** Store type */
  type: StoreType;
  /** Store/collection name */
  name: string;
  /** Base directory for file stores (default: '.reqon-data') */
  baseDir?: string;
  /** File store options */
  fileOptions?: FileStoreOptions;
  /** PostgREST/Supabase options */
  postgrest?: Omit<PostgRESTOptions, 'table'>;
  /** Logger instance */
  logger?: Logger;
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
  const logger = options.logger ?? createLogger();

  switch (options.type) {
    case 'memory':
      return new MemoryStore(options.name);

    case 'file':
      return new FileStore(options.name, {
        ...options.fileOptions,
        baseDir: options.baseDir ?? '.reqon-data',
      });

    case 'postgrest':
      if (!options.postgrest) {
        throw new Error(`PostgREST store requires 'postgrest' options with url and apiKey`);
      }
      return new PostgRESTStore({
        ...options.postgrest,
        table: options.name,
      });

    case 'sql':
      // If postgrest options provided, use PostgREST adapter (works with Supabase)
      if (options.postgrest) {
        return new PostgRESTStore({
          ...options.postgrest,
          table: options.name,
        });
      }
      // TODO: Implement raw SQL adapter (pg, mysql2, etc.)
      logger.warn(`SQL store not yet implemented, falling back to file store for '${options.name}'`);
      return new FileStore(options.name, {
        ...options.fileOptions,
        baseDir: options.baseDir ?? '.reqon-data/sql',
      });

    case 'nosql':
      // TODO: Implement NoSQL adapter
      logger.warn(`NoSQL store not yet implemented, falling back to file store for '${options.name}'`);
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
  dslType: 'sql' | 'nosql' | 'memory' | 'file' | 'postgrest',
  developmentMode = true
): StoreType {
  // These types are used directly
  if (dslType === 'memory' || dslType === 'file' || dslType === 'postgrest') {
    return dslType;
  }

  if (developmentMode) {
    // Use file stores for local development
    return 'file';
  }

  // In production, use the actual type
  return dslType;
}
