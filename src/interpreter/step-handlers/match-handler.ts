import type { MatchStep, ActionStep, FlowDirective } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import type { ExecutionContext } from '../context.js';
import { findMatchingSchema } from '../schema-matcher.js';

/**
 * Result of executing a match step
 */
export interface MatchResult {
  /** The schema that matched (or '_' for wildcard) */
  matchedSchema: string;
  /** Flow directive if the arm specifies one */
  flow?: FlowDirective;
  /** Whether steps were executed (vs flow directive) */
  stepsExecuted: boolean;
}

export interface MatchHandlerDeps extends StepHandlerDeps {
  executeStep: (step: ActionStep, actionName: string, ctx: ExecutionContext) => Promise<void>;
  actionName: string;
}

/**
 * Error thrown when a match step has no matching arm
 */
export class NoMatchError extends Error {
  constructor(public value: unknown) {
    super('No matching schema found for response');
    this.name = 'NoMatchError';
  }
}

/**
 * Error thrown when a match arm triggers an abort
 */
export class AbortError extends Error {
  constructor(message?: string) {
    super(message ?? 'Execution aborted');
    this.name = 'AbortError';
  }
}

/**
 * Signal thrown when a match arm triggers skip
 */
export class SkipSignal extends Error {
  constructor() {
    super('Skip remaining steps');
    this.name = 'SkipSignal';
  }
}

/**
 * Signal thrown when a match arm triggers retry
 */
export class RetrySignal extends Error {
  constructor(public backoff?: { maxAttempts: number; backoff: string; initialDelay: number }) {
    super('Retry action');
    this.name = 'RetrySignal';
  }
}

/**
 * Signal thrown when a match arm triggers jump
 */
export class JumpSignal extends Error {
  constructor(
    public action: string,
    public then?: 'retry' | 'continue'
  ) {
    super(`Jump to action: ${action}`);
    this.name = 'JumpSignal';
  }
}

/**
 * Signal thrown when a match arm triggers queue
 */
export class QueueSignal extends Error {
  constructor(
    public value: unknown,
    public target?: string
  ) {
    super('Queue for later processing');
    this.name = 'QueueSignal';
  }
}

/**
 * Handles match steps (schema overloading with flow control)
 */
export class MatchHandler {
  constructor(private deps: MatchHandlerDeps) {}

  async execute(step: MatchStep): Promise<void> {
    const value = evaluate(step.target, this.deps.ctx);

    // Get schema names from arms in order
    const schemaNames = step.arms.map(arm => arm.schema);

    // Find matching schema
    const matchedSchema = findMatchingSchema(value, this.deps.ctx.schemas, schemaNames);

    if (!matchedSchema) {
      throw new NoMatchError(value);
    }

    this.deps.log(`Matched schema: ${matchedSchema}`);

    // Find the matching arm
    const arm = step.arms.find(a => a.schema === matchedSchema);

    if (!arm) {
      // Shouldn't happen if findMatchingSchema works correctly
      throw new NoMatchError(value);
    }

    // Handle flow directive
    if (arm.flow) {
      // 'continue' means proceed normally - don't throw
      if (arm.flow.type === 'continue') {
        return;
      }
      this.handleFlowDirective(arm.flow, value);
    }

    // Execute steps
    if (arm.steps) {
      for (const innerStep of arm.steps) {
        await this.deps.executeStep(innerStep, this.deps.actionName, this.deps.ctx);
      }
    }
  }

  private handleFlowDirective(flow: Exclude<FlowDirective, { type: 'continue' }>, value: unknown): never {
    switch (flow.type) {
      case 'skip':
        throw new SkipSignal();

      case 'abort':
        throw new AbortError(flow.message);

      case 'retry':
        throw new RetrySignal(flow.backoff);

      case 'jump':
        throw new JumpSignal(flow.action, flow.then);

      case 'queue':
        throw new QueueSignal(value, flow.target);

      default:
        // This should never happen if TypeScript is working correctly
        const _exhaustive: never = flow;
        throw new Error(`Unknown flow directive: ${(_exhaustive as FlowDirective).type}`);
    }
  }
}
