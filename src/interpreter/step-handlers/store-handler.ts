import type { StoreStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import type { StoreAdapter } from '../../stores/types.js';
import { evaluate } from '../evaluator.js';
import { RuntimeError } from '../../errors/index.js';

/**
 * Handles store steps for persisting data to configured store adapters.
 * Supports bulk operations, upserts, and partial record updates.
 */
export class StoreHandler implements StepHandler<StoreStep> {
  constructor(private deps: StepHandlerDeps) {}

  /**
   * Compute the storage key for a record based on step options.
   *
   * Uses the key expression if provided, otherwise falls back to `record.id`.
   * A missing or null/undefined key is an error: inventing a random key breaks
   * dedup (re-runs duplicate everything), and stringifying undefined collapses
   * every such record onto the literal key "undefined".
   */
  private getRecordKey(step: StoreStep, record: Record<string, unknown>): string {
    const raw = step.options.key ? evaluate(step.options.key, this.deps.ctx, record) : record.id;

    if (raw === undefined || raw === null || raw === '') {
      const which = step.options.key ? 'key expression' : "record 'id'";
      throw new RuntimeError(
        `Cannot store to '${step.target}': ${which} is missing or empty. ` +
          `Provide a 'key:' option that resolves to a stable, non-empty value.`,
        undefined,
        undefined,
        { stepType: 'store' }
      );
    }

    return String(raw);
  }

  /**
   * Emit a data.store event with operation metadata.
   */
  private emitStoreEvent(
    step: StoreStep,
    operation: 'set' | 'upsert',
    itemCount: number,
    key?: string
  ): void {
    this.deps.emit?.('data.store', {
      storeName: step.target,
      storeType: this.deps.ctx.storeTypes.get(step.target) ?? 'unknown',
      operation,
      itemCount,
      ...(key !== undefined && { key }),
    });
  }

  async execute(step: StoreStep): Promise<void> {
    const store = this.deps.ctx.stores.get(step.target);
    if (!store) {
      throw new RuntimeError(`Store not found: ${step.target}`, undefined, undefined, {
        stepType: 'store',
      });
    }

    const source = evaluate(step.source, this.deps.ctx);

    if (Array.isArray(source)) {
      await this.storeMany(step, store, source);
    } else if (source === null || source === undefined) {
      // An empty response body (or an expression that resolved to nothing) is a
      // no-op, not an error: there is simply nothing to persist. Casting it to a
      // record and reading `.id` off it would throw a raw TypeError.
      this.deps.log(`Nothing to store to ${step.target} (source is empty)`);
    } else if (typeof source !== 'object') {
      // A bare scalar (string/number/boolean) has no key to store under. Raise
      // the same deliberate RuntimeError as a missing key rather than a raw
      // TypeError from reading `.id` off a primitive.
      throw new RuntimeError(
        `Cannot store to '${step.target}': expected an object or array, ` +
          `got ${typeof source}. A store source must be a record (or list of records).`,
        undefined,
        undefined,
        { stepType: 'store' }
      );
    } else {
      await this.storeOne(step, store, source as Record<string, unknown>);
    }
  }

  private async storeMany(step: StoreStep, store: StoreAdapter, items: unknown[]): Promise<void> {
    const merge = this.shouldMerge(step);
    const operation = merge ? 'upsert' : 'set';
    const records: Array<{ key: string; value: Record<string, unknown> }> = [];

    for (const item of items) {
      const record = item as Record<string, unknown>;
      const key = this.getRecordKey(step, record);
      records.push({ key, value: record });
    }

    // Check if we can use bulk operations
    if (merge && store.bulkUpsert) {
      await store.bulkUpsert(records);
    } else if (!merge && store.bulkSet) {
      await store.bulkSet(records);
    } else {
      // Fall back to individual operations for stores without bulk methods
      for (const { key, value } of records) {
        await this.storeRecord(step, store, key, value);
      }
    }

    this.deps.log(
      `Stored ${items.length} ${items.length === 1 ? 'item' : 'items'} to ${step.target}`
    );
    this.emitStoreEvent(step, operation, items.length);
  }

  private async storeOne(
    step: StoreStep,
    store: StoreAdapter,
    record: Record<string, unknown>
  ): Promise<void> {
    const key = this.getRecordKey(step, record);
    const operation = this.shouldMerge(step) ? 'upsert' : 'set';

    await this.storeRecord(step, store, key, record);
    this.deps.log(`Stored item to ${step.target}`);
    this.emitStoreEvent(step, operation, 1, key);
  }

  /** True when the record should be merged into an existing one (deep upsert). */
  private shouldMerge(step: StoreStep): boolean {
    return step.options.upsert === true || step.options.partial === true;
  }

  private async storeRecord(
    step: StoreStep,
    store: StoreAdapter,
    key: string,
    record: Record<string, unknown>
  ): Promise<void> {
    // Never mutate the caller's record or persist a storage-internal flag.
    if (this.shouldMerge(step)) {
      await store.update(key, record);
    } else {
      await store.set(key, record);
    }
  }
}
