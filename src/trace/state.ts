/**
 * Trace State - Types for time-travel debugging
 *
 * Captures full execution state snapshots at each step,
 * enabling replay and debugging of pipeline runs.
 */

/**
 * A single step snapshot in the execution trace
 */
export interface TraceSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** Index in the trace sequence */
  index: number;
  /** Timestamp when snapshot was captured */
  timestamp: Date;
  /** Mission name */
  mission: string;
  /** Current action name */
  action: string;
  /** Step index within action */
  stepIndex: number;
  /** Step type (fetch, for, map, etc.) */
  stepType: string;
  /** Phase: before or after step execution */
  phase: 'before' | 'after';
  /** All variables in scope (deep cloned) */
  variables: Record<string, unknown>;
  /** Current response value (deep cloned) */
  response?: unknown;
  /** Store states - map of store name to item count and sample */
  stores: Record<string, StoreSnapshot>;
  /** Duration of step execution (only for 'after' phase) */
  stepDuration?: number;
  /** Error if step failed */
  error?: string;
  /** For loop context (if inside a for loop) */
  loopContext?: LoopContext;
}

/**
 * Snapshot of a store's state
 */
export interface StoreSnapshot {
  /** Store type (memory, file, etc.) */
  type: string;
  /** Number of items in store */
  itemCount: number;
  /** Sample of recent items (limited to avoid huge traces) */
  sampleItems?: unknown[];
}

/**
 * Context when inside a for loop
 */
export interface LoopContext {
  /** Loop variable name */
  variable: string;
  /** Current item index */
  itemIndex: number;
  /** Total items in collection */
  totalItems: number;
  /** Current item value */
  currentItem?: unknown;
}

/**
 * Complete trace for a mission execution
 */
export interface ExecutionTrace {
  /** Trace ID (same as execution ID) */
  id: string;
  /** Mission name */
  mission: string;
  /** Trace mode (full or minimal) */
  mode: 'full' | 'minimal';
  /** When trace started */
  startedAt: Date;
  /** When trace completed */
  completedAt?: Date;
  /** Total duration in ms */
  duration?: number;
  /** Whether execution succeeded */
  success?: boolean;
  /** All snapshots in execution order */
  snapshots: TraceSnapshot[];
  /** Metadata from execution */
  metadata?: Record<string, unknown>;
}

/**
 * Generate a unique snapshot ID
 */
export function generateSnapshotId(traceId: string, index: number): string {
  return `${traceId}_snap_${index.toString().padStart(6, '0')}`;
}

/**
 * Create a new execution trace
 */
export function createExecutionTrace(
  executionId: string,
  mission: string,
  mode: 'full' | 'minimal',
  metadata?: Record<string, unknown>
): ExecutionTrace {
  return {
    id: executionId,
    mission,
    mode,
    startedAt: new Date(),
    snapshots: [],
    metadata,
  };
}

/**
 * Safe deep clone that handles circular references and special types
 */
export function safeClone<T>(value: T, maxDepth = 10): T {
  const seen = new WeakSet();

  function clone(val: unknown, depth: number): unknown {
    if (depth > maxDepth) return '[max depth exceeded]';
    if (val === null || typeof val !== 'object') return val;
    if (val instanceof Date) return new Date(val.getTime());
    if (val instanceof RegExp) return new RegExp(val.source, val.flags);
    if (seen.has(val as object)) return '[circular reference]';

    seen.add(val as object);

    if (Array.isArray(val)) {
      return val.map((item) => clone(item, depth + 1));
    }

    if (val instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of val) {
        result[String(k)] = clone(v, depth + 1);
      }
      return result;
    }

    if (val instanceof Set) {
      return Array.from(val).map((item) => clone(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(val as object)) {
      result[key] = clone((val as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  }

  return clone(value, 0) as T;
}

/**
 * Truncate large values for trace storage
 */
export function truncateForTrace(value: unknown, maxItems = 100, maxStringLength = 1000): unknown {
  if (typeof value === 'string' && value.length > maxStringLength) {
    return value.slice(0, maxStringLength) + `... [truncated, ${value.length} chars total]`;
  }

  if (Array.isArray(value) && value.length > maxItems) {
    return [...value.slice(0, maxItems), `... [truncated, ${value.length} items total]`];
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > maxItems) {
      const result: Record<string, unknown> = {};
      for (const key of keys.slice(0, maxItems)) {
        result[key] = (value as Record<string, unknown>)[key];
      }
      result['__truncated__'] = `${keys.length} keys total`;
      return result;
    }
  }

  return value;
}
