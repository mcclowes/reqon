import type { ApplyStep, TransformDefinition, TransformVariant } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { evaluate } from '../evaluator.js';
import { matchesSchema } from '../schema-matcher.js';
import { setVariable } from '../context.js';

/**
 * Extended dependencies for ApplyHandler - includes transform definition
 */
export interface ApplyHandlerDeps extends StepHandlerDeps {
  transform: TransformDefinition;
}

/**
 * Handles apply transform steps with overloading support.
 *
 * The apply step applies a named transform to a source value.
 * If the transform has multiple variants (overloaded), it finds
 * the first matching variant based on schema matching and guards.
 */
export class ApplyHandler implements StepHandler<ApplyStep> {
  constructor(private deps: ApplyHandlerDeps) {}

  async execute(step: ApplyStep): Promise<void> {
    const source = evaluate(step.source, this.deps.ctx) as Record<string, unknown>;
    const transform = this.deps.transform;

    // Find matching variant
    const variant = this.findMatchingVariant(source, transform.variants);
    if (!variant) {
      throw new Error(
        `No matching transform variant found for '${transform.name}'. ` +
          `Source does not match any of the ${transform.variants.length} variant(s).`
      );
    }

    // Apply the variant's mappings
    const mapped: Record<string, unknown> = {};
    for (const mapping of variant.mappings) {
      mapped[mapping.field] = evaluate(mapping.expression, this.deps.ctx, source);
    }

    // Store result - either in a variable (if 'as' specified) or in response
    if (step.as) {
      setVariable(this.deps.ctx, step.as, mapped);
      this.deps.log(`Applied ${transform.name} to ${step.as}`);
    } else {
      this.deps.ctx.response = mapped;
      this.deps.log(`Applied ${transform.name} -> ${variant.targetSchema}`);
    }
  }

  /**
   * Find the first matching transform variant for the given source value.
   *
   * Matching rules:
   * 1. Wildcard ('_') always matches
   * 2. Named schema must match using schema matcher
   * 3. Optional guard condition must evaluate to truthy
   */
  private findMatchingVariant(
    source: Record<string, unknown>,
    variants: TransformVariant[]
  ): TransformVariant | undefined {
    for (const variant of variants) {
      // Wildcard always matches
      if (variant.sourceSchema === '_') {
        // Check guard if present
        if (variant.guard) {
          const guardResult = evaluate(variant.guard, this.deps.ctx, source);
          if (!guardResult) continue;
        }
        return variant;
      }

      // Check if source matches the schema
      const schema = this.deps.ctx.schemas.get(variant.sourceSchema);
      if (!schema) {
        // Schema not defined - skip this variant
        this.deps.log(`Warning: Schema '${variant.sourceSchema}' not found, skipping variant`);
        continue;
      }

      if (matchesSchema(source, schema)) {
        // Check guard if present
        if (variant.guard) {
          const guardResult = evaluate(variant.guard, this.deps.ctx, source);
          if (!guardResult) continue;
        }
        return variant;
      }
    }

    return undefined;
  }
}
