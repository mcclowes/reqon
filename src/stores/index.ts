/**
 * ---
 * purpose: Store adapters - pluggable storage backends for pipeline data
 * exports:
 *   - StoreAdapter - interface for all stores
 *   - MemoryStore, FileStore, PostgRESTStore - implementations
 *   - createStore - factory function
 * related:
 *   - ./types.ts - StoreAdapter interface definition
 *   - ./memory.ts - in-memory store (default)
 *   - ./file.ts - JSON/CSV file store
 *   - ./postgrest.ts - PostgREST API store
 *   - ../interpreter/context.ts - stores registered in context
 * ---
 */

export type { StoreAdapter, StoreFilter, StoreConfig } from './types.js';
export { applyStoreFilter } from './types.js';
export { MemoryStore } from './memory.js';
export { FileStore, type FileStoreOptions } from './file.js';
export { PostgRESTStore, PostgRESTError, type PostgRESTOptions } from './postgrest.js';
export { BatchingStore, type BatchOptions } from './batching.js';
export {
  createStore,
  resolveStoreType,
  type StoreType,
  type CreateStoreOptions,
} from './factory.js';
