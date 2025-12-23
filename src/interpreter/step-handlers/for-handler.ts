import type { ForStep, ActionStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import { childContext, setVariable, getVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';
import { StepError } from '../../errors/index.js';
import type { DebugController, DebugSnapshot, DebugLocation } from '../../debug/index.js';

export interface ForHandlerDeps extends StepHandlerDeps {
  executeStep: (step: ActionStep, actionName: string, ctx: ExecutionContext) => Promise<void>;
  actionName: string;
  debugController?: DebugController;
  captureDebugSnapshot?: (
    action: string,
    stepIndex: number,
    stepType: string,
    pauseReason: { type: 'loop-iteration'; variable: string; index: number; total: number },
    ctx: ExecutionContext
  ) => DebugSnapshot;
  handleDebugCommand?: (cmd: { type: string }) => void;
}

/**
 * Handles for...in...where iteration steps
 */
export class ForHandler implements StepHandler<ForStep> {
  constructor(private deps: ForHandlerDeps) {}

  async execute(step: ForStep): Promise<void> {
    const collection = await this.getCollection(step);
    const originalCount = collection.length;

    // Apply filter if present
    const filtered = step.condition
      ? collection.filter((item) => evaluate(step.condition!, this.deps.ctx, item))
      : collection;

    // Emit loop.start event
    this.deps.emit?.('loop.start', {
      variable: step.variable,
      collectionSize: filtered.length,
      hasFilter: !!step.condition,
    });

    this.deps.log(`Iterating over ${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`);

    let processedCount = 0;
    let failedCount = 0;

    // Execute steps for each item
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];

      // Emit loop.iteration event
      this.deps.emit?.('loop.iteration', {
        variable: step.variable,
        itemIndex: i,
        totalItems: filtered.length,
      });

      // Debug pause point - before each loop iteration (step-into mode)
      if (this.deps.debugController && this.deps.captureDebugSnapshot && this.deps.handleDebugCommand) {
        const location: DebugLocation = {
          action: this.deps.actionName,
          stepIndex: -1, // Use -1 for loop iterations
          stepType: 'for-iteration',
          isLoopIteration: true,
          loopInfo: { variable: step.variable, index: i, total: filtered.length },
        };
        if (this.deps.debugController.shouldPause(location)) {
          // Create child context to capture loop variable
          const previewCtx = childContext(this.deps.ctx);
          setVariable(previewCtx, step.variable, item);

          const snapshot = this.deps.captureDebugSnapshot(
            this.deps.actionName,
            -1,
            'for-iteration',
            { type: 'loop-iteration', variable: step.variable, index: i, total: filtered.length },
            previewCtx
          );
          const command = await this.deps.debugController.pause(snapshot);
          this.deps.handleDebugCommand(command);
        }
      }

      try {
        await this.executeForItem(step, item);
        processedCount++;
      } catch (error) {
        failedCount++;
        throw error; // Re-throw to propagate
      }
    }

    // Emit loop.complete event
    this.deps.emit?.('loop.complete', {
      variable: step.variable,
      totalItems: filtered.length,
      itemsProcessed: processedCount,
      itemsSkipped: originalCount - filtered.length,
      itemsFailed: failedCount,
    });
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
      throw new StepError(
        'For loop collection must be an array',
        'for',
        { action: this.deps.actionName }
      );
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
