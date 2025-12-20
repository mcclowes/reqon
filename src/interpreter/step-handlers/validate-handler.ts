import type { ValidateStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';

/**
 * Handles validate steps with assume constraints
 */
export class ValidateHandler implements StepHandler<ValidateStep> {
  constructor(private deps: StepHandlerDeps) {}

  async execute(step: ValidateStep): Promise<void> {
    const target = evaluate(step.target, this.deps.ctx);

    for (const constraint of step.constraints) {
      const result = evaluate(constraint.condition, this.deps.ctx, target);

      if (!result) {
        const message = constraint.message ?? `Validation failed: ${JSON.stringify(constraint.condition)}`;

        if (constraint.severity === 'error') {
          throw new Error(message);
        } else {
          this.deps.log(`Warning: ${message}`);
        }
      }
    }

    this.deps.log('Validation passed');
  }
}
