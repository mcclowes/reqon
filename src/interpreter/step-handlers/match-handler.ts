import type { MatchStep, ActionStep, FlowDirective } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import type { ExecutionContext } from '../context.js';
import { findMatchingSchema } from '../schema-matcher.js';
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
      // Check if schema matches
      if (arm.schema !== '_') {
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
      throw new NoMatchError(value);
    }

    this.deps.log(`Matched schema: ${matchedArm.schema}${matchedArm.guard ? ' (with guard)' : ''}`);

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
      if (this.deps.debugController && this.deps.captureDebugSnapshot && this.deps.handleDebugCommand) {
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
