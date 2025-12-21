import type { StoreStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import type { StoreAdapter } from '../../stores/types.js';
import { evaluate } from '../evaluator.js';

/**
 * Handles store steps for persisting data
 */
export class StoreHandler implements StepHandler<StoreStep> {
  constructor(private deps: StepHandlerDeps) {}

  async execute(step: StoreStep): Promise<void> {
    const store = this.deps.ctx.stores.get(step.target);
    if (!store) {
      throw new Error(`Store not found: ${step.target}`);
    }

    const source = evaluate(step.source, this.deps.ctx);

    if (Array.isArray(source)) {
      await this.storeMany(step, store, source);
    } else {
      await this.storeOne(step, store, source as Record<string, unknown>);
    }
  }

  private async storeMany(step: StoreStep, store: StoreAdapter, items: unknown[]): Promise<void> {
    const operation = step.options.upsert ? 'upsert' : 'set';

    // Check if we can use bulk operations
    const canBulkSet = store.bulkSet && !step.options.upsert;
    const canBulkUpsert = store.bulkUpsert && step.options.upsert;

    if (canBulkSet || canBulkUpsert) {
      const records: Array<{ key: string; value: Record<string, unknown> }> = [];
      for (const item of items) {
        const record = item as Record<string, unknown>;
        const key = step.options.key
          ? String(evaluate(step.options.key, this.deps.ctx, record))
          : String(record.id ?? Math.random());

        if (step.options.partial !== undefined) {
          record._partial = step.options.partial;
        }
        records.push({ key, value: record });
      }

      if (canBulkUpsert) {
        await store.bulkUpsert!(records);
      } else {
        await store.bulkSet!(records);
      }
    } else {
      // Fall back to individual operations for stores without bulk methods
      for (const item of items) {
        const record = item as Record<string, unknown>;
        await this.storeRecord(step, store, record);
      }
    }

    this.deps.log(`Stored ${items.length} items to ${step.target}`);

    // Emit data.store event
    this.deps.emit?.('data.store', {
      storeName: step.target,
      storeType: this.deps.ctx.storeTypes.get(step.target) ?? 'unknown',
      operation,
      itemCount: items.length,
    });
  }

  private async storeOne(step: StoreStep, store: StoreAdapter, record: Record<string, unknown>): Promise<void> {
    const key = step.options.key
      ? String(evaluate(step.options.key, this.deps.ctx, record))
      : String(record.id ?? Math.random());

    await this.storeRecord(step, store, record);
    this.deps.log(`Stored item to ${step.target}`);

    // Emit data.store event
    this.deps.emit?.('data.store', {
      storeName: step.target,
      storeType: this.deps.ctx.storeTypes.get(step.target) ?? 'unknown',
      operation: step.options.upsert ? 'upsert' : 'set',
      itemCount: 1,
      key,
    });
  }

  private async storeRecord(
    step: StoreStep,
    store: StoreAdapter,
    record: Record<string, unknown>
  ): Promise<void> {
    const key = step.options.key
      ? String(evaluate(step.options.key, this.deps.ctx, record))
      : String(record.id ?? Math.random());

    if (step.options.partial !== undefined) {
      record._partial = step.options.partial;
    }

    if (step.options.upsert) {
      await store.update(key, record);
    } else {
      await store.set(key, record);
    }
  }
}
