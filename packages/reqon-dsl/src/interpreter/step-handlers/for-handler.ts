import { createHash } from 'node:crypto';
import type { ForStep, ActionStep, LoopErrorPolicy } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import { childContext, setVariable } from '../context.js';
import type { ExecutionContext } from '../context.js';
import { StepError } from '../../errors/index.js';
import { SkipSignal, QueueSignal, markTolerated } from '../signals.js';
import { isRecord } from '../../utils/type-guards.js';
import { CONCURRENCY_DEFAULTS } from '../../config/constants.js';
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
  /** Reports an item the loop tolerated, so the run can summarise the damage. */
  onItemFailed?: (info: { action: string; index: number; error: string }) => void;
  /**
   * Ceiling on iterations in flight, shared with `run [A, B]` parallel stages
   * so both fan-out mechanisms answer to one limit (#262). A loop declaring
   * more is clamped, loudly. Defaults to CONCURRENCY_DEFAULTS.MAX_PARALLEL.
   */
  maxConcurrency?: number;
}

/**
 * Handles for...in...where iteration steps
 */
export class ForHandler implements StepHandler<ForStep> {
  constructor(private deps: ForHandlerDeps) {}

  async execute(step: ForStep): Promise<void> {
    const collection = await this.getCollection(step);
    const originalCount = collection.length;

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
    const requested = this.deps.debugController ? 1 : (step.concurrency ?? 1);
    const ceiling = this.deps.maxConcurrency ?? CONCURRENCY_DEFAULTS.MAX_PARALLEL;
    const concurrency = Math.min(requested, ceiling);
    if (requested > ceiling) {
      this.deps.log(
        `Loop concurrency ${requested} exceeds the maximum of ${ceiling}; running ${ceiling} in flight (raise via maxParallel)`
      );
    }
    if (concurrency > 1) {
      await this.executeConcurrently(step, filtered, concurrency, originalCount);
      return;
    }

    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];

      // Check for pause request every N iterations
      if (i > 0 && i % LOOP_HEARTBEAT_INTERVAL === 0) {
        await this.deps.checkPause?.();

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
        if (this.errorPolicy(step).action === 'abort') throw error;
        await this.recordFailure(step, item, i, error);
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
    let collection: unknown;

    if (step.collection.type === 'Identifier') {
      const name = step.collection.name;
      const store = this.deps.ctx.stores.get(name);
      // A store wins; otherwise evaluate the identifier like any expression —
      // that resolves variables AND the special `response` binding. The old
      // direct variable lookup missed `response` and fell back to [], so
      // `for item in response` silently iterated nothing.
      if (store && this.isVariableInScope(name)) {
        this.deps.log(
          `Store '${name}' shadows a variable of the same name; iterating the store. ` +
            `Rename one of them if you meant the variable.`
        );
      }
      collection = store ? await store.list() : evaluate(step.collection, this.deps.ctx);
    } else {
      collection = evaluate(step.collection, this.deps.ctx);
    }

    if (!Array.isArray(collection)) {
      const name = step.collection.type === 'Identifier' ? ` '${step.collection.name}'` : '';
      throw new StepError(
        `For loop collection${name} must be an array, got ${collection === undefined ? 'nothing in scope' : typeof collection}`,
        'for',
        { action: this.deps.actionName }
      );
    }

    return collection;
  }

  /** True when `name` resolves as a variable in the current scope chain. */
  private isVariableInScope(name: string): boolean {
    for (let scope: ExecutionContext | undefined = this.deps.ctx; scope; scope = scope.parent) {
      if (scope.variables.has(name)) return true;
    }
    return false;
  }

  /**
   * Run iterations with a bounded number in flight.
   *
   * Under the default `continue` policy a failed item is recorded and the
   * workers keep pulling. Under `onError abort` the first error stops workers
   * pulling new items, iterations already in flight are allowed to finish, and
   * the error is then rethrown - matching the sequential path's "stop on error"
   * without abandoning half-done work mid-write.
   */
  private async executeConcurrently(
    step: ForStep,
    items: unknown[],
    concurrency: number,
    originalCount: number
  ): Promise<void> {
    let next = 0;
    let processedCount = 0;
    let failedCount = 0;
    let attemptedCount = 0;
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
          if (this.errorPolicy(step).action === 'abort') {
            firstError ??= error;
            return;
          }
          failedCount++;
          await this.recordFailure(step, items[i], i, error);
        }

        // Heartbeat on attempts, not successes: a run of consecutively-failing
        // items must still emit liveness and honour pause requests (#262).
        // Attempts are monotonic even with workers interleaving.
        attemptedCount++;
        if (attemptedCount % LOOP_HEARTBEAT_INTERVAL === 0) {
          await this.deps.checkPause?.();
          this.deps.emit?.('loop.heartbeat', {
            variable: step.variable,
            current: attemptedCount,
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
      itemsFailed: failedCount + (firstError === undefined ? 0 : 1),
    });

    if (firstError !== undefined) throw firstError;
  }

  /** Continue past failed items unless the loop opted into strict mode. */
  private errorPolicy(step: ForStep): LoopErrorPolicy {
    return step.onError ?? { action: 'continue' };
  }

  /**
   * Log a tolerated failure and, if the loop named a queue, record the item.
   *
   * Always logged: continuing by default means a broken mission (every request
   * 401ing, say) would otherwise finish "successfully" having stored nothing,
   * and a silent zero is worse than a loud failure.
   */
  private async recordFailure(
    step: ForStep,
    item: unknown,
    index: number,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    markTolerated(error);
    this.deps.log(`Item ${index} failed, continuing: ${message}`);

    this.deps.emit?.('loop.item.failed', {
      variable: step.variable,
      itemIndex: index,
      error: message,
    });
    this.deps.onItemFailed?.({ action: this.deps.actionName, index, error: message });

    const queue = this.errorPolicy(step).queue;
    if (!queue) return;

    const store = this.deps.ctx.stores.get(queue);
    if (!store) {
      throw new StepError(`onError queue store not found: ${queue}`, 'for', {
        action: this.deps.actionName,
      });
    }

    const status = (error as { statusCode?: number })?.statusCode;
    await store.set(this.deadLetterKey(step, item, index), {
      item,
      error: message,
      ...(status !== undefined ? { status } : {}),
      action: this.deps.actionName,
      index,
      failedAt: new Date().toISOString(),
    });
  }

  /**
   * Key a dead-letter entry by the identity of the failed record, never its
   * loop position. Index keys silently overwrite each other when two loops share
   * one `onError queue` store, and across re-runs and resumes (#256) - so the
   * store whose whole job is not to lose failures loses them. Namespaced by
   * action + loop variable so two loops can safely share a store.
   */
  private deadLetterKey(step: ForStep, item: unknown, index: number): string {
    return `${this.deps.actionName}:${step.variable}:${recordIdentity(item, index)}`;
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

/**
 * Derive a stable identity for a failed loop item, preferring a natural key,
 * then a content hash, and only falling back to position for values that have
 * neither (null/undefined). Identity is a property of the record; position is a
 * property of one traversal (#256).
 */
function recordIdentity(item: unknown, index: number): string {
  if (isRecord(item)) {
    const natural = item.id ?? item._id ?? item.key ?? item.uuid;
    if (natural !== undefined && natural !== null && natural !== '') {
      return `id-${String(natural)}`;
    }
    return `sha-${hashContent(JSON.stringify(item))}`;
  }
  if (item !== undefined && item !== null) {
    return `val-${hashContent(String(item))}`;
  }
  return `idx-${index}`;
}

function hashContent(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
