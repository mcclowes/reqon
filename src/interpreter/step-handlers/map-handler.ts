import type { MapStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';

/**
 * Handles map...-> transformation steps
 */
export class MapHandler implements StepHandler<MapStep> {
  constructor(private deps: StepHandlerDeps) {}

  async execute(step: MapStep): Promise<void> {
    const source = evaluate(step.source, this.deps.ctx) as Record<string, unknown>;

    const mapped: Record<string, unknown> = {};

    for (const mapping of step.mappings) {
      mapped[mapping.field] = evaluate(mapping.expression, this.deps.ctx, source);
    }

    // Store mapped result in response for next step
    this.deps.ctx.response = mapped;
    this.deps.log(`Mapped to ${step.targetSchema}`);
  }
}
