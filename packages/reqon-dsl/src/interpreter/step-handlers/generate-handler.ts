import { Generator, createContext as createVagueContext, type DatasetDefinition } from 'vague-lang';
import type { GenerateStep } from '../../ast/nodes.js';
import type { StepHandler, StepHandlerDeps } from './types.js';
import { setVariable } from '../context.js';

/** Generates deterministic fixture data from schemas already registered by the mission. */
export class GenerateHandler implements StepHandler<GenerateStep> {
  constructor(private deps: StepHandlerDeps) {}

  async execute(step: GenerateStep): Promise<void> {
    const schema = this.deps.ctx.schemas.get(step.schema);
    if (!schema) throw new Error(`Generate schema not found: ${step.schema}`);

    const dataset: DatasetDefinition = {
      type: 'DatasetDefinition',
      name: `ReqonGenerated${step.schema}`,
      collections: [
        {
          type: 'CollectionDefinition',
          name: step.as,
          cardinality: { type: 'Cardinality', min: step.count, max: step.count },
          schemaRef: step.schema,
        },
      ],
    };
    const vagueContext = createVagueContext({ seed: step.seed });
    const generator = new Generator(vagueContext);
    const generated = await generator.generate({
      type: 'Program',
      statements: [...this.deps.ctx.schemas.values(), dataset],
    });
    const records = generated[step.as] ?? [];
    setVariable(this.deps.ctx, step.as, records);
    this.deps.ctx.response = records;
    this.deps.log(`Generated ${records.length} ${step.schema} records as '${step.as}'`);
  }
}
