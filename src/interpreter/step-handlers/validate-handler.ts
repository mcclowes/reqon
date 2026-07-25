import type { ValidateStep, ActionStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import type { ExecutionContext } from '../context.js';
import { evaluate } from '../evaluator.js';
import { ValidationError } from '../../errors/index.js';

export interface ValidateHandlerDeps extends StepHandlerDeps {
  /** Executes a step, used to run an `or { ... }` fallback block. */
  executeStep?: (step: ActionStep, actionName: string, ctx: ExecutionContext) => Promise<void>;
  actionName?: string;
}

/**
 * Handles validate steps with assume constraints.
 * Evaluates constraint conditions and throws ValidationError on failure,
 * unless an `or { ... }` fallback block is provided — then the fallback runs
 * and execution continues.
 */
export class ValidateHandler implements StepHandler<ValidateStep> {
  constructor(private deps: ValidateHandlerDeps) {}

  async execute(step: ValidateStep): Promise<void> {
    const target = evaluate(step.target, this.deps.ctx);

    for (const constraint of step.constraints) {
      const result = evaluate(constraint.condition, this.deps.ctx, target);

      if (!result) {
        const message =
          constraint.message ?? `Validation failed: ${JSON.stringify(constraint.condition)}`;

        // A warning-severity constraint never fails the step or triggers the
        // fallback; it only logs.
        if (constraint.severity !== 'error') {
          this.deps.log(`Warning: ${message}`);
          continue;
        }

        // Error-severity failure: run the fallback block if present, otherwise
        // throw. The fallback replaces the throw and lets the pipeline continue.
        if (step.fallback && step.fallback.length > 0) {
          this.deps.log(`Validation failed, running fallback: ${message}`);
          if (!this.deps.executeStep || this.deps.actionName === undefined) {
            throw new Error('validate fallback requires an executeStep binding');
          }
          for (const fallbackStep of step.fallback) {
            await this.deps.executeStep(fallbackStep, this.deps.actionName, this.deps.ctx);
          }
          return;
        }

        throw new ValidationError(message, { line: 1, column: 1 }, undefined, {
          constraint: JSON.stringify(constraint.condition),
          severity: 'error',
        });
      }
    }

    this.deps.log('Validation passed');
  }
}
