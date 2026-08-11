/**
 * StoreManager handles store initialization and configuration.
 *
 * Extracted from MissionExecutor to improve separation of concerns.
 * Responsible for:
 * - Creating store adapters based on store definitions
 * - Managing custom store adapters
 * - Resolving store types for development/production modes
 */

import type { StoreDefinition } from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import type { StoreAdapter } from '../stores/types.js';
import { createStore, resolveStoreType } from '../stores/index.js';
import { EXECUTION_DEFAULTS } from '../config/index.js';

export interface StoreManagerConfig {
  /** Custom store adapters by name */
  customStores?: Record<string, StoreAdapter>;
  /** Development mode - use file stores instead of sql/nosql (default: false) */
  developmentMode?: boolean;
  /** Base directory for file stores (default: '.reqon-data') */
  dataDir?: string;
  /** Logging function */
  log?: (message: string) => void;
}

/**
 * Manages store initialization and provides access to store adapters.
 */
export class StoreManager {
  private config: StoreManagerConfig;

  constructor(config: StoreManagerConfig = {}) {
    this.config = config;
  }

  /**
   * Initialize a store definition, creating the appropriate adapter.
   */
  async initializeStore(store: StoreDefinition, ctx: ExecutionContext): Promise<void> {
    if (this.config.customStores?.[store.name]) {
      ctx.stores.set(store.name, this.config.customStores[store.name]);
      ctx.storeTypes.set(store.name, 'custom');
      this.log(`Initialized store: ${store.name} (custom adapter)`);
      return;
    }

    // Use store factory to create appropriate adapter
    const developmentMode = this.config.developmentMode ?? EXECUTION_DEFAULTS.DEVELOPMENT_MODE;
    const storeType = resolveStoreType(store.storeType, developmentMode);

    const adapter = createStore({
      type: storeType,
      name: store.target,
      baseDir: this.config.dataDir,
      // In dev mode the type is already resolved to 'file'; this only matters
      // if a raw sql/nosql type reaches the factory.
      allowFileFallback: developmentMode,
      // AST uses `maxDelay`; the store layer uses `maxDelayMs`.
      batch: store.batch
        ? {
            size: store.batch.size,
            maxDelayMs: store.batch.maxDelay,
            durability: store.batch.durability,
          }
        : undefined,
    });

    ctx.stores.set(store.name, adapter);
    ctx.storeTypes.set(store.name, storeType);

    const batchInfo = store.batch ? `, batch ${store.batch.size}` : '';
    const typeInfo = storeType !== store.storeType ? ` <- ${store.storeType}` : '';
    this.log(`Initialized store: ${store.name} (${storeType}${typeInfo}${batchInfo})`);
  }

  /**
   * Flush and close every store, so a batching or batch-mode file store writes
   * its final partial batch. Called however the run ends.
   */
  async closeStores(ctx: ExecutionContext): Promise<void> {
    const closable = ctx.stores as Map<string, StoreAdapter & { close?: () => unknown }>;
    await Promise.all(
      Array.from(closable.values()).map(async (store) => {
        if (typeof store.close === 'function') await store.close();
      })
    );
  }

  /**
   * Initialize multiple stores.
   */
  async initializeStores(stores: StoreDefinition[], ctx: ExecutionContext): Promise<void> {
    for (const store of stores) {
      await this.initializeStore(store, ctx);
    }
  }

  /**
   * Get a store adapter from the context.
   */
  getStore(ctx: ExecutionContext, storeName: string): StoreAdapter | undefined {
    return ctx.stores.get(storeName);
  }

  /**
   * Get the store type for a given store name.
   */
  getStoreType(ctx: ExecutionContext, storeName: string): string | undefined {
    return ctx.storeTypes.get(storeName);
  }

  private log(message: string): void {
    this.config.log?.(message);
  }
}
