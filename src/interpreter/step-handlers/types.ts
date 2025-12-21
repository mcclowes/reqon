import type { ActionStep } from '../../ast/nodes.js';
import type { ExecutionContext } from '../context.js';
import type { EventEmitter, EventType } from '../../observability/index.js';

/**
 * Dependencies injected into step handlers
 */
export interface StepHandlerDeps {
  ctx: ExecutionContext;
  log: (message: string) => void;
  /** Optional event emitter for observability */
  emit?: <T>(type: EventType, payload: T) => void;
}

/**
 * Base interface for step handlers
 */
export interface StepHandler<TStep extends ActionStep> {
  execute(step: TStep): Promise<void>;
}
