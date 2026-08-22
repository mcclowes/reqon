/**
 * Trace Recorder - Captures execution state for time-travel debugging
 *
 * Used by the executor to record snapshots at each step,
 * building a complete trace that can be replayed later.
 */

import type { ExecutionContext } from '../interpreter/context.js';
import type { TraceStore } from './store.js';
import {
  type ExecutionTrace,
  type TraceSnapshot,
  type StoreSnapshot,
  type LoopContext,
  createExecutionTrace,
  generateSnapshotId,
  safeClone,
  truncateForTrace,
} from './state.js';
import { redactSecrets } from '../utils/redact.js';

export interface TraceRecorderConfig {
  /** Execution ID (used as trace ID) */
  executionId: string;
  /** Mission name */
  mission: string;
  /** Trace mode */
  mode: 'full' | 'minimal';
  /** Store for persisting traces */
  store: TraceStore;
  /** Metadata to attach to trace */
  metadata?: Record<string, unknown>;
  /** Whether to stream snapshots (append as they happen) vs batch at end */
  streaming?: boolean;
  /** Max items to include in store samples */
  maxStoreItems?: number;
}

/**
 * Records execution state for time-travel debugging
 */
export class TraceRecorder {
  private config: TraceRecorderConfig;
  private trace: ExecutionTrace;
  private snapshotIndex = 0;
  private currentLoopContext?: LoopContext;

  constructor(config: TraceRecorderConfig) {
    this.config = config;
    this.trace = createExecutionTrace(
      config.executionId,
      config.mission,
      config.mode,
      config.metadata
    );
  }

  /**
   * Record a snapshot before step execution
   */
  async recordBeforeStep(
    action: string,
    stepIndex: number,
    stepType: string,
    ctx: ExecutionContext
  ): Promise<void> {
    const snapshot = this.createSnapshot(action, stepIndex, stepType, 'before', ctx);
    await this.addSnapshot(snapshot);
  }

  /**
   * Record a snapshot after step execution
   */
  async recordAfterStep(
    action: string,
    stepIndex: number,
    stepType: string,
    ctx: ExecutionContext,
    stepDuration: number,
    error?: string
  ): Promise<void> {
    const snapshot = this.createSnapshot(action, stepIndex, stepType, 'after', ctx);
    snapshot.stepDuration = stepDuration;
    snapshot.error = error;
    await this.addSnapshot(snapshot);
  }

  /**
   * Set loop context for subsequent snapshots
   */
  setLoopContext(context: LoopContext | undefined): void {
    this.currentLoopContext = context;
  }

  /**
   * Finalize the trace (called when execution completes)
   */
  async finalize(success: boolean): Promise<ExecutionTrace> {
    this.trace.completedAt = new Date();
    this.trace.duration = this.trace.completedAt.getTime() - this.trace.startedAt.getTime();
    this.trace.success = success;

    // If not streaming, save entire trace at end
    if (!this.config.streaming) {
      await this.config.store.save(this.trace);
    }

    return this.trace;
  }

  /**
   * Get the current trace (without finalizing)
   */
  getTrace(): ExecutionTrace {
    return this.trace;
  }

  /**
   * Get a specific snapshot by index
   */
  getSnapshot(index: number): TraceSnapshot | undefined {
    return this.trace.snapshots[index];
  }

  /**
   * Get the total number of snapshots recorded. In streaming mode the in-memory
   * array is bounded (older snapshots live only on disk), so this reflects the
   * true total rather than the retained window.
   */
  getSnapshotCount(): number {
    return this.snapshotIndex;
  }

  private createSnapshot(
    action: string,
    stepIndex: number,
    stepType: string,
    phase: 'before' | 'after',
    ctx: ExecutionContext
  ): TraceSnapshot {
    const index = this.snapshotIndex++;

    // Capture variables from context chain. Trace files are diagnostic and
    // persisted to disk, so redact credential-looking fields.
    const variables = redactSecrets(this.captureVariables(ctx));

    // Capture store states
    const stores = this.captureStores(ctx);

    // Capture response (truncated for large responses)
    const response =
      this.config.mode === 'full'
        ? redactSecrets(truncateForTrace(safeClone(ctx.response)))
        : undefined;

    return {
      id: generateSnapshotId(this.trace.id, index),
      index,
      timestamp: new Date(),
      mission: this.trace.mission,
      action,
      stepIndex,
      stepType,
      phase,
      variables,
      response,
      stores,
      loopContext: this.currentLoopContext ? { ...this.currentLoopContext } : undefined,
    };
  }

  private captureVariables(ctx: ExecutionContext): Record<string, unknown> {
    const variables: Record<string, unknown> = {};
    let current: ExecutionContext | undefined = ctx;

    while (current) {
      for (const [key, value] of current.variables) {
        if (!(key in variables)) {
          // Clone and truncate for trace storage
          variables[key] =
            this.config.mode === 'full' ? truncateForTrace(safeClone(value)) : typeof value;
        }
      }
      current = current.parent;
    }

    return variables;
  }

  private captureStores(ctx: ExecutionContext): Record<string, StoreSnapshot> {
    const stores: Record<string, StoreSnapshot> = {};
    const maxItems = this.config.maxStoreItems ?? 10;

    for (const [name, _store] of ctx.stores) {
      const storeType = ctx.storeTypes.get(name) ?? 'unknown';

      // Note: Getting actual item count would require async call
      // For now, we just record the type
      stores[name] = {
        type: storeType,
        itemCount: -1, // Would need async to get actual count
        sampleItems: this.config.mode === 'full' ? [] : undefined,
      };

      // In full mode, we could sample items if we had sync access
      // For now, this is a placeholder for future enhancement
      if (this.config.mode === 'full' && maxItems > 0) {
        // TODO: Add async store sampling if needed
      }
    }

    return stores;
  }

  /** Cap on snapshots kept in memory while streaming (each is already on disk). */
  private static readonly MAX_STREAMED_IN_MEMORY = 200;

  /** Whether the trace shell has been saved ahead of streamed snapshots. */
  private shellSaved = false;

  private async addSnapshot(snapshot: TraceSnapshot): Promise<void> {
    this.trace.snapshots.push(snapshot);

    if (this.config.streaming) {
      // Save the trace shell before the first streamed snapshot: appendSnapshot
      // targets an existing trace, and a store that hasn't seen save() yet
      // (e.g. MemoryTraceStore) would silently drop every snapshot.
      if (!this.shellSaved) {
        this.shellSaved = true;
        await this.config.store.save({ ...this.trace, snapshots: [] });
      }
      // Persisted immediately, so the in-memory copy is only a recent window for
      // live inspection — bound it so a long run doesn't grow without limit.
      await this.config.store.appendSnapshot(this.trace.id, snapshot);
      const cap = TraceRecorder.MAX_STREAMED_IN_MEMORY;
      if (this.trace.snapshots.length > cap) {
        this.trace.snapshots.splice(0, this.trace.snapshots.length - cap);
      }
    }
  }
}

/**
 * Create a trace recorder for an execution
 */
export function createTraceRecorder(config: TraceRecorderConfig): TraceRecorder {
  return new TraceRecorder(config);
}
