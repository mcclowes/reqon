import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MapStep, FieldMapping } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { MapHandler } from './map-handler.js';
import { createContext, setVariable } from '../context.js';
import type { StepHandlerDeps } from './types.js';

describe('MapHandler', () => {
  let deps: StepHandlerDeps;

  beforeEach(() => {
    deps = {
      ctx: createContext(),
      log: vi.fn(),
    };
  });

  describe('basic field mapping', () => {
    it('maps simple fields from source to target schema', async () => {
      deps.ctx.response = {
        first_name: 'Alice',
        last_name: 'Smith',
        email_address: 'alice@example.com',
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'User',
        mappings: [
          {
            field: 'firstName',
            expression: { type: 'Identifier', name: 'first_name' } as Expression,
          },
          {
            field: 'lastName',
            expression: { type: 'Identifier', name: 'last_name' } as Expression,
          },
          {
            field: 'email',
            expression: { type: 'Identifier', name: 'email_address' } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
      });
    });

    it('maps nested properties using qualified names', async () => {
      deps.ctx.response = {
        user: {
          profile: {
            displayName: 'Alice Wonder',
          },
          settings: {
            theme: 'dark',
          },
        },
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'UserInfo',
        mappings: [
          {
            field: 'name',
            expression: {
              type: 'QualifiedName',
              parts: ['user', 'profile', 'displayName'],
            } as Expression,
          },
          {
            field: 'theme',
            expression: {
              type: 'QualifiedName',
              parts: ['user', 'settings', 'theme'],
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        name: 'Alice Wonder',
        theme: 'dark',
      });
    });

    it('maps literal values', async () => {
      deps.ctx.response = { data: 'test' };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'StaticData',
        mappings: [
          {
            field: 'version',
            expression: { type: 'Literal', value: '1.0.0', dataType: 'string' } as Expression,
          },
          {
            field: 'count',
            expression: { type: 'Literal', value: 42, dataType: 'number' } as Expression,
          },
          {
            field: 'enabled',
            expression: { type: 'Literal', value: true, dataType: 'boolean' } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        version: '1.0.0',
        count: 42,
        enabled: true,
      });
    });
  });

  describe('expression mapping', () => {
    it('maps computed expressions', async () => {
      deps.ctx.response = {
        price: 100,
        quantity: 5,
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'OrderTotal',
        mappings: [
          {
            field: 'total',
            expression: {
              type: 'BinaryExpression',
              operator: '*',
              left: { type: 'Identifier', name: 'price' },
              right: { type: 'Identifier', name: 'quantity' },
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        total: 500,
      });
    });

    it('maps ternary expressions', async () => {
      deps.ctx.response = {
        score: 85,
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'Grade',
        mappings: [
          {
            field: 'grade',
            expression: {
              type: 'TernaryExpression',
              condition: {
                type: 'BinaryExpression',
                operator: '>=',
                left: { type: 'Identifier', name: 'score' },
                right: { type: 'Literal', value: 80, dataType: 'number' },
              },
              consequent: { type: 'Literal', value: 'A', dataType: 'string' },
              alternate: { type: 'Literal', value: 'B', dataType: 'string' },
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        grade: 'A',
      });
    });

    it('maps with string concatenation', async () => {
      deps.ctx.response = {
        firstName: 'Alice',
        lastName: 'Smith',
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'FullName',
        mappings: [
          {
            field: 'fullName',
            expression: {
              type: 'BinaryExpression',
              operator: '+',
              left: {
                type: 'BinaryExpression',
                operator: '+',
                left: { type: 'Identifier', name: 'firstName' },
                right: { type: 'Literal', value: ' ', dataType: 'string' },
              },
              right: { type: 'Identifier', name: 'lastName' },
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        fullName: 'Alice Smith',
      });
    });
  });

  describe('source from variable', () => {
    it('maps from a context variable instead of response', async () => {
      setVariable(deps.ctx, 'inputData', {
        x: 10,
        y: 20,
      });

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'inputData' } as Expression,
        targetSchema: 'Point',
        mappings: [
          {
            field: 'latitude',
            expression: { type: 'Identifier', name: 'x' } as Expression,
          },
          {
            field: 'longitude',
            expression: { type: 'Identifier', name: 'y' } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        latitude: 10,
        longitude: 20,
      });
    });
  });

  describe('empty and partial mappings', () => {
    it('handles empty mappings array', async () => {
      deps.ctx.response = { data: 'original' };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'Empty',
        mappings: [],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({});
    });

    it('handles undefined source fields gracefully', async () => {
      deps.ctx.response = {
        existingField: 'value',
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'Partial',
        mappings: [
          {
            field: 'present',
            expression: { type: 'Identifier', name: 'existingField' } as Expression,
          },
          {
            field: 'missing',
            expression: { type: 'Identifier', name: 'nonExistent' } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        present: 'value',
        missing: undefined,
      });
    });
  });

  describe('logging', () => {
    it('logs the target schema', async () => {
      deps.ctx.response = { a: 1 };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'MyTargetSchema',
        mappings: [
          {
            field: 'x',
            expression: { type: 'Identifier', name: 'a' } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Mapped to MyTargetSchema');
    });
  });

  describe('built-in function calls in mappings', () => {
    it('uses length function in mapping', async () => {
      deps.ctx.response = {
        items: [1, 2, 3, 4, 5],
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'Summary',
        mappings: [
          {
            field: 'itemCount',
            expression: {
              type: 'CallExpression',
              callee: 'length',
              arguments: [{ type: 'Identifier', name: 'items' }],
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        itemCount: 5,
      });
    });

    it('uses round function in mapping', async () => {
      deps.ctx.response = {
        value: 3.7,
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'Rounded',
        mappings: [
          {
            field: 'rounded',
            expression: {
              type: 'CallExpression',
              callee: 'round',
              arguments: [{ type: 'Identifier', name: 'value' }],
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        rounded: 4,
      });
    });
  });

  describe('match expressions in mappings', () => {
    it('uses match expression for status mapping', async () => {
      deps.ctx.response = {
        statusCode: 'A',
      };

      const step: MapStep = {
        type: 'MapStep',
        source: { type: 'Identifier', name: 'response' } as Expression,
        targetSchema: 'Status',
        mappings: [
          {
            field: 'status',
            expression: {
              type: 'MatchExpression',
              value: { type: 'Identifier', name: 'statusCode' },
              arms: [
                {
                  pattern: { type: 'Literal', value: 'A', dataType: 'string' },
                  result: { type: 'Literal', value: 'Active', dataType: 'string' },
                },
                {
                  pattern: { type: 'Literal', value: 'I', dataType: 'string' },
                  result: { type: 'Literal', value: 'Inactive', dataType: 'string' },
                },
                {
                  pattern: { type: 'Identifier', name: '_' },
                  result: { type: 'Literal', value: 'Unknown', dataType: 'string' },
                },
              ],
            } as Expression,
          },
        ],
      };

      const handler = new MapHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual({
        status: 'Active',
      });
    });
  });
});
