import type { ForStep, ActionStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import { childContext, setVariable, getVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';

export interface ForHandlerDeps extends StepHandlerDeps {
  executeStep: (step: ActionStep, actionName: string, ctx: ExecutionContext) => Promise<void>;
  actionName: string;
}

/**
 * Handles for...in...where iteration steps
 */
export class ForHandler implements StepHandler<ForStep> {
  constructor(private deps: ForHandlerDeps) {}

  async execute(step: ForStep): Promise<void> {
    const collection = await this.getCollection(step);

    // Apply filter if present
    const filtered = step.condition
      ? collection.filter((item) => evaluate(step.condition!, this.deps.ctx, item))
      : collection;

    this.deps.log(`Iterating over ${filtered.length} items`);

    // Execute steps for each item
    for (const item of filtered) {
      await this.executeForItem(step, item);
    }
  }

  private async getCollection(step: ForStep): Promise<unknown[]> {
    let collection: unknown[];

    if (step.collection.type === 'Identifier') {
      // It's a store reference
      const store = this.deps.ctx.stores.get(step.collection.name);
      if (store) {
        collection = await store.list();
      } else {
        collection = (getVariable(this.deps.ctx, step.collection.name) as unknown[]) ?? [];
      }
    } else {
      collection = evaluate(step.collection, this.deps.ctx) as unknown[];
    }

    if (!Array.isArray(collection)) {
      throw new Error('For loop collection must be an array');
    }

    return collection;
  }

  private async executeForItem(step: ForStep, item: unknown): Promise<void> {
    const childCtx = childContext(this.deps.ctx);
    setVariable(childCtx, step.variable, item);

    // Execute each inner step with child context
    for (const innerStep of step.steps) {
      await this.deps.executeStep(innerStep, this.deps.actionName, childCtx);
    }
  }
}
