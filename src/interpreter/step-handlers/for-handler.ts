import type { ForStep, ActionStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import { childContext, setVariable, getVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';
import { StepError } from '../../errors/index.js';
import { SkipSignal, QueueSignal } from '../signals.js';
import type { DebugController, DebugSnapshot, DebugLocation } from '../../debug/index.js';

/** Heartbeat interval for loop iterations */
const LOOP_HEARTBEAT_INTERVAL = 10;

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
  /** Optional callback to check for pause requests (called every N iterations) */
  checkPause?: () => Promise<void>;
  /** Handle a `queue` directive raised within a loop item. */
  handleQueue?: (signal: QueueSignal) => Promise<void>;
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

    // A debugger needs deterministic, one-at-a-time stepping, so it wins over
    // any declared concurrency.
    const concurrency = this.deps.debugController ? 1 : (step.concurrency ?? 1);
    if (concurrency > 1) {
      await this.executeConcurrently(step, filtered, concurrency, originalCount);
      return;
    }

    // Execute steps for each item
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];

      // Check for pause request every N iterations
      if (i > 0 && i % LOOP_HEARTBEAT_INTERVAL === 0) {
        await this.deps.checkPause?.();

        // Emit heartbeat every N iterations
        this.deps.emit?.('loop.heartbeat', {
          variable: step.variable,
          current: i,
          total: filtered.length,
          processedCount,
        });
      }

      // Emit loop.iteration event
      this.deps.emit?.('loop.iteration', {
        variable: step.variable,
        itemIndex: i,
        totalItems: filtered.length,
      });

      // Debug pause point - before each loop iteration (step-into mode)
      if (
        this.deps.debugController &&
        this.deps.captureDebugSnapshot &&
        this.deps.handleDebugCommand
      ) {
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
      throw new StepError('For loop collection must be an array', 'for', {
        action: this.deps.actionName,
      });
    }

    return collection;
  }

  /**
   * Run iterations with a bounded number in flight.
   *
   * Failure is fail-fast on the queue: the first error stops workers pulling new
   * items, iterations already in flight are allowed to finish, and the first
   * error is then rethrown. That keeps the sequential path's "stop on error"
   * promise without abandoning half-done work mid-write.
   */
  private async executeConcurrently(
    step: ForStep,
    items: unknown[],
    concurrency: number,
    originalCount: number
  ): Promise<void> {
    let next = 0;
    let processedCount = 0;
    let firstError: unknown;

    const worker = async (): Promise<void> => {
      for (let i = next++; i < items.length; i = next++) {
        if (firstError !== undefined) return;

        this.deps.emit?.('loop.iteration', {
          variable: step.variable,
          itemIndex: i,
          totalItems: items.length,
        });

        try {
          await this.executeForItem(step, items[i], `[${i}]`);
          processedCount++;
        } catch (error) {
          firstError ??= error;
          return;
        }

        // Heartbeat on completions rather than a loop counter: with workers
        // interleaving, completions are the only monotonic measure of progress.
        if (processedCount % LOOP_HEARTBEAT_INTERVAL === 0) {
          await this.deps.checkPause?.();
          this.deps.emit?.('loop.heartbeat', {
            variable: step.variable,
            current: processedCount,
            total: items.length,
            processedCount,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

    this.deps.emit?.('loop.complete', {
      variable: step.variable,
      totalItems: items.length,
      itemsProcessed: processedCount,
      itemsSkipped: originalCount - items.length,
      itemsFailed: firstError === undefined ? 0 : 1,
    });

    if (firstError !== undefined) throw firstError;
  }

  /**
   * @param idPrefix - set for concurrent iterations, giving the item its own
   * step-index namespace so interleaving can't scramble step ids.
   */
  private async executeForItem(step: ForStep, item: unknown, idPrefix?: string): Promise<void> {
    const childCtx = childContext(this.deps.ctx);
    if (idPrefix !== undefined) {
      const parent = this.deps.ctx.actionScope;
      childCtx.actionScope = {
        stepIndex: 0,
        attempt: parent?.attempt ?? 0,
        // Shared by reference: checkpoints belong to the action, not the item.
        pendingCheckpoints: parent?.pendingCheckpoints ?? [],
        idPrefix: `${parent?.idPrefix ?? ''}${idPrefix}`,
      };
    }
    setVariable(childCtx, step.variable, item);

    try {
      // Execute each inner step with child context
      for (const innerStep of step.steps) {
        await this.deps.executeStep(innerStep, this.deps.actionName, childCtx);
      }
    } catch (error) {
      // `skip` skips the rest of this item's steps; the loop continues.
      if (error instanceof SkipSignal) {
        return;
      }
      // `queue` stashes the item and moves on to the next iteration.
      if (error instanceof QueueSignal) {
        await this.deps.handleQueue?.(error);
        return;
      }
      throw error;
    }
  }
}
