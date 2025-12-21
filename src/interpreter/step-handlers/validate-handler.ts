import type { ValidateStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import { ValidationError } from '../../errors/index.js';

/**
 * Handles validate steps with assume constraints.
 * Evaluates constraint conditions and throws ValidationError on failure.
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
          throw new ValidationError(
            message,
            { line: 1, column: 1 },
            undefined,
            { constraint: JSON.stringify(constraint.condition), severity: 'error' }
          );
        } else {
          this.deps.log(`Warning: ${message}`);
        }
      }
    }

    this.deps.log('Validation passed');
  }
}
