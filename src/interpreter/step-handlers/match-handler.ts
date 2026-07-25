import type { MatchStep, MatchArm, ActionStep, FlowDirective } from '../../ast/nodes.js';
import type { StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import type { ExecutionContext } from '../context.js';
import { findMatchingSchema, matchesSchema } from '../schema-matcher.js';
import {
  NoMatchError,
  AbortError,
  SkipSignal,
  RetrySignal,
  JumpSignal,
  QueueSignal,
} from '../signals.js';
import type { DebugController, DebugSnapshot, DebugLocation } from '../../debug/index.js';

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
  debugController?: DebugController;
  captureDebugSnapshot?: (
    action: string,
    stepIndex: number,
    stepType: string,
    pauseReason: { type: 'match-arm'; schema: string },
    ctx: ExecutionContext
  ) => DebugSnapshot;
  handleDebugCommand?: (cmd: { type: string }) => void;
}

/** How an arm was written, for logs and the no-match error. */
function describeArm(arm: MatchArm): string {
  if (arm.status !== undefined) return String(arm.status);
  return arm.isArray ? `[${arm.schema}]` : arm.schema;
}

/**
 * Handles match steps (schema overloading with flow control)
 */
export class MatchHandler {
  constructor(private deps: MatchHandlerDeps) {}

  async execute(step: MatchStep): Promise<void> {
    const value = evaluate(step.target, this.deps.ctx);

    // Find matching arm, checking guards
    let matchedArm = null;

    for (const arm of step.arms) {
      if (arm.status !== undefined) {
        // A status arm dispatches on the last response's status, not its body.
        if (this.deps.ctx.responseStatus !== arm.status) {
          continue;
        }
      } else if (arm.isArray) {
        // `[Schema]` arm: the value must be an array whose every element
        // satisfies the schema. An empty array matches vacuously.
        if (!Array.isArray(value)) {
          continue;
        }
        const schema = this.deps.ctx.schemas.get(arm.schema);
        if (!schema) {
          continue;
        }
        if (!value.every((element) => matchesSchema(element, schema))) {
          continue;
        }
      } else if (arm.schema !== '_') {
        // Check if this schema matches the value
        const schemaMatches = findMatchingSchema(value, this.deps.ctx.schemas, [arm.schema]);
        if (!schemaMatches) {
          continue;
        }
      }

      // If there's a guard, check it
      if (arm.guard) {
        const guardResult = evaluate(arm.guard, this.deps.ctx, value);
        if (!guardResult) {
          continue; // Guard failed, try next arm
        }
      }

      // Found a match
      matchedArm = arm;
      break;
    }

    if (!matchedArm) {
      // A match written purely on statuses is a status dispatch, not a schema
      // assertion: `404 -> skip` next to `allow: [404]` says what to do about a
      // 404 and nothing about a 200. Failing the step there would make every
      // successful response need a `_ -> continue` companion arm.
      if (step.arms.every((arm) => arm.status !== undefined)) {
        return;
      }
      throw new NoMatchError(value, step.arms.map(describeArm));
    }

    const matchedLabel = describeArm(matchedArm);
    this.deps.log(`Matched schema: ${matchedLabel}${matchedArm.guard ? ' (with guard)' : ''}`);

    // Handle flow directive
    if (matchedArm.flow) {
      // 'continue' means proceed normally - don't throw
      if (matchedArm.flow.type === 'continue') {
        return;
      }
      this.handleFlowDirective(matchedArm.flow, value);
    }

    // Execute steps
    if (matchedArm.steps) {
      // Debug pause point - before match arm body (step-into mode)
      if (
        this.deps.debugController &&
        this.deps.captureDebugSnapshot &&
        this.deps.handleDebugCommand
      ) {
        const location: DebugLocation = {
          action: this.deps.actionName,
          stepIndex: -1, // Use -1 for match arms
          stepType: 'match-arm',
          isMatchArm: true,
          matchInfo: { schema: matchedArm.schema },
        };
        if (this.deps.debugController.shouldPause(location)) {
          const snapshot = this.deps.captureDebugSnapshot(
            this.deps.actionName,
            -1,
            'match-arm',
            { type: 'match-arm', schema: matchedArm.schema },
            this.deps.ctx
          );
          const command = await this.deps.debugController.pause(snapshot);
          this.deps.handleDebugCommand(command);
        }
      }

      for (const innerStep of matchedArm.steps) {
        await this.deps.executeStep(innerStep, this.deps.actionName, this.deps.ctx);
      }
    }
  }

  private handleFlowDirective(
    flow: Exclude<FlowDirective, { type: 'continue' }>,
    value: unknown
  ): never {
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

      default: {
        // This should never happen if TypeScript is working correctly
        const _exhaustive: never = flow;
        throw new Error(`Unknown flow directive: ${(_exhaustive as FlowDirective).type}`);
      }
    }
  }
}
