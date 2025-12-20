import type { StoreStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
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
      await this.storeMany(step, source);
    } else {
      await this.storeOne(step, source as Record<string, unknown>);
    }
  }

  private async storeMany(step: StoreStep, items: unknown[]): Promise<void> {
    const store = this.deps.ctx.stores.get(step.target)!;

    for (const item of items) {
      const record = item as Record<string, unknown>;
      await this.storeRecord(step, store, record);
    }

    this.deps.log(`Stored ${items.length} items to ${step.target}`);
  }

  private async storeOne(step: StoreStep, record: Record<string, unknown>): Promise<void> {
    const store = this.deps.ctx.stores.get(step.target)!;
    await this.storeRecord(step, store, record);
    this.deps.log(`Stored item to ${step.target}`);
  }

  private async storeRecord(
    step: StoreStep,
    store: { set: (key: string, value: Record<string, unknown>) => Promise<void>; update: (key: string, value: Partial<Record<string, unknown>>) => Promise<void> },
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
