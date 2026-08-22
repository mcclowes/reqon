import type { ActionStep } from '../../ast/nodes.js';
import type { ExecutionContext } from '../context.js';
import type { EventType } from '../../observability/index.js';

/**
 * Dependencies injected into step handlers
 */
export interface StepHandlerDeps {
  ctx: ExecutionContext;
  /**
   * Structured log. Optional `context` becomes key=value pairs (text) or fields
   * (JSON). Handler-level narration is per-item chatter and is routed to the
   * `debug` level by the executor, below the `info`-level progress line.
   */
  log: (message: string, context?: Record<string, unknown>) => void;
  /** Optional event emitter for observability */
  emit?: <T>(type: EventType, payload: T) => void;
}

/**
 * Base interface for step handlers
 */
export interface StepHandler<TStep extends ActionStep> {
  execute(step: TStep): Promise<void>;
}
