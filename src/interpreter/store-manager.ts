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
import { createStore, resolveStoreType, type StoreType } from '../stores/index.js';

export interface StoreManagerConfig {
  /** Custom store adapters by name */
  customStores?: Record<string, StoreAdapter>;
  /** Development mode - use file stores instead of sql/nosql (default: true) */
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
    // Check for custom store adapter
    if (this.config.customStores?.[store.name]) {
      ctx.stores.set(store.name, this.config.customStores[store.name]);
      ctx.storeTypes.set(store.name, 'custom');
      this.log(`Initialized store: ${store.name} (custom adapter)`);
      return;
    }

    // Use store factory to create appropriate adapter
    const developmentMode = this.config.developmentMode ?? true;
    const storeType = resolveStoreType(store.storeType, developmentMode);

    const adapter = createStore({
      type: storeType,
      name: store.target,
      baseDir: this.config.dataDir,
    });

    ctx.stores.set(store.name, adapter);
    ctx.storeTypes.set(store.name, storeType);

    const typeInfo = storeType !== store.storeType ? ` <- ${store.storeType}` : '';
    this.log(`Initialized store: ${store.name} (${storeType}${typeInfo})`);
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
