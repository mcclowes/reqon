import { describe, expect, it, vi } from 'vitest';
import { createContext, getVariable } from '../context.js';
import { GenerateHandler } from './generate-handler.js';

describe('GenerateHandler', () => {
  it('generates seeded schema records into a variable and response', async () => {
    const ctx = createContext();
    ctx.schemas.set('Customer', {
      type: 'SchemaDefinition',
      name: 'Customer',
      fields: [
        {
          type: 'FieldDefinition',
          name: 'score',
          fieldType: {
            type: 'RangeType',
            baseType: { type: 'PrimitiveType', name: 'int' },
            min: { type: 'Literal', value: 1, dataType: 'number' },
            max: { type: 'Literal', value: 100, dataType: 'number' },
          },
        },
      ],
    });
    const log = vi.fn();
    const step = {
      type: 'GenerateStep',
      count: 3,
      schema: 'Customer',
      as: 'customers',
      seed: 42,
    } as const;

    await new GenerateHandler({ ctx, log }).execute(step);
    const first = getVariable(ctx, 'customers');
    expect(first).toHaveLength(3);
    expect(ctx.response).toEqual(first);

    const secondCtx = createContext();
    secondCtx.schemas = ctx.schemas;
    await new GenerateHandler({ ctx: secondCtx, log }).execute(step);
    expect(getVariable(secondCtx, 'customers')).toEqual(first);
  });
});
