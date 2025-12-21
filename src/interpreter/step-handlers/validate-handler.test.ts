import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ValidateStep, ValidationConstraint } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { ValidateHandler } from './validate-handler.js';
import { createContext, setVariable } from '../context.js';
import type { StepHandlerDeps } from './types.js';

describe('ValidateHandler', () => {
  let deps: StepHandlerDeps;

  beforeEach(() => {
    deps = {
      ctx: createContext(),
      log: vi.fn(),
    };
  });

  describe('passing validation', () => {
    it('passes when all constraints are met', async () => {
      deps.ctx.response = { age: 25, name: 'Alice' };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>=',
              left: { type: 'Identifier', name: 'age' },
              right: { type: 'Literal', value: 18, dataType: 'number' },
            } as Expression,
            severity: 'error',
          },
          {
            condition: {
              type: 'BinaryExpression',
              operator: '!=',
              left: { type: 'Identifier', name: 'name' },
              right: { type: 'Literal', value: '', dataType: 'string' },
            } as Expression,
            severity: 'error',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
      expect(deps.log).toHaveBeenCalledWith('Validation passed');
    });

    it('passes with single constraint', async () => {
      deps.ctx.response = { count: 10 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'count' },
              right: { type: 'Literal', value: 0, dataType: 'number' },
            } as Expression,
            severity: 'error',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
    });

    it('passes with boolean field check', async () => {
      deps.ctx.response = { enabled: true };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: { type: 'Identifier', name: 'enabled' } as Expression,
            severity: 'error',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
    });
  });

  describe('failing validation with errors', () => {
    it('throws when error constraint fails', async () => {
      deps.ctx.response = { age: 15 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>=',
              left: { type: 'Identifier', name: 'age' },
              right: { type: 'Literal', value: 18, dataType: 'number' },
            } as Expression,
            severity: 'error',
            message: 'Age must be at least 18',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('Age must be at least 18');
    });

    it('throws with default message when no custom message provided', async () => {
      deps.ctx.response = { value: -5 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'value' },
              right: { type: 'Literal', value: 0, dataType: 'number' },
            } as Expression,
            severity: 'error',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('Validation failed:');
    });

    it('throws on first failing error constraint', async () => {
      deps.ctx.response = { a: 0, b: 0 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'a' },
              right: { type: 'Literal', value: 0, dataType: 'number' },
            } as Expression,
            severity: 'error',
            message: 'First constraint failed',
          },
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'b' },
              right: { type: 'Literal', value: 0, dataType: 'number' },
            } as Expression,
            severity: 'error',
            message: 'Second constraint failed',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('First constraint failed');
    });
  });

  describe('warning severity', () => {
    it('logs warning but does not throw', async () => {
      deps.ctx.response = { score: 50 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>=',
              left: { type: 'Identifier', name: 'score' },
              right: { type: 'Literal', value: 70, dataType: 'number' },
            } as Expression,
            severity: 'warning',
            message: 'Score is below recommended threshold',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
      expect(deps.log).toHaveBeenCalledWith('Warning: Score is below recommended threshold');
    });

    it('logs warning with default message when not provided', async () => {
      deps.ctx.response = { value: 5 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'value' },
              right: { type: 'Literal', value: 10, dataType: 'number' },
            } as Expression,
            severity: 'warning',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Warning: Validation failed:'));
    });

    it('continues after warning to check other constraints', async () => {
      deps.ctx.response = { a: 5, b: 0 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'a' },
              right: { type: 'Literal', value: 10, dataType: 'number' },
            } as Expression,
            severity: 'warning',
            message: 'a is low',
          },
          {
            condition: {
              type: 'BinaryExpression',
              operator: '>',
              left: { type: 'Identifier', name: 'b' },
              right: { type: 'Literal', value: 0, dataType: 'number' },
            } as Expression,
            severity: 'error',
            message: 'b must be positive',
          },
        ],
      };

      const handler = new ValidateHandler(deps);

      // Should log the warning first, then throw on the error
      await expect(handler.execute(step)).rejects.toThrow('b must be positive');
      expect(deps.log).toHaveBeenCalledWith('Warning: a is low');
    });
  });

  describe('mixed constraints', () => {
    it('handles mix of passing and warning constraints', async () => {
      deps.ctx.response = { required: 'present', optional: '' };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '!=',
              left: { type: 'Identifier', name: 'required' },
              right: { type: 'Literal', value: '', dataType: 'string' },
            } as Expression,
            severity: 'error',
            message: 'Required field missing',
          },
          {
            condition: {
              type: 'BinaryExpression',
              operator: '!=',
              left: { type: 'Identifier', name: 'optional' },
              right: { type: 'Literal', value: '', dataType: 'string' },
            } as Expression,
            severity: 'warning',
            message: 'Optional field is empty',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Warning: Optional field is empty');
      expect(deps.log).toHaveBeenCalledWith('Validation passed');
    });
  });

  describe('target from variable', () => {
    it('validates data from a context variable', async () => {
      setVariable(deps.ctx, 'myData', { count: 100 });

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'myData' } as Expression,
        constraints: [
          {
            condition: {
              type: 'BinaryExpression',
              operator: '<=',
              left: { type: 'Identifier', name: 'count' },
              right: { type: 'Literal', value: 1000, dataType: 'number' },
            } as Expression,
            severity: 'error',
            message: 'Count exceeds maximum',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
    });
  });

  describe('complex conditions', () => {
    it('validates with logical AND condition', async () => {
      deps.ctx.response = { min: 10, max: 20 };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'LogicalExpression',
              operator: 'and',
              left: {
                type: 'BinaryExpression',
                operator: '>',
                left: { type: 'Identifier', name: 'min' },
                right: { type: 'Literal', value: 0, dataType: 'number' },
              },
              right: {
                type: 'BinaryExpression',
                operator: '<',
                left: { type: 'Identifier', name: 'max' },
                right: { type: 'Literal', value: 100, dataType: 'number' },
              },
            } as Expression,
            severity: 'error',
            message: 'Values out of range',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
    });

    it('validates with logical OR condition', async () => {
      deps.ctx.response = { status: 'active' };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'LogicalExpression',
              operator: 'or',
              left: {
                type: 'BinaryExpression',
                operator: '==',
                left: { type: 'Identifier', name: 'status' },
                right: { type: 'Literal', value: 'active', dataType: 'string' },
              },
              right: {
                type: 'BinaryExpression',
                operator: '==',
                left: { type: 'Identifier', name: 'status' },
                right: { type: 'Literal', value: 'pending', dataType: 'string' },
              },
            } as Expression,
            severity: 'error',
            message: 'Invalid status',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
    });

    it('validates with NOT condition', async () => {
      deps.ctx.response = { deleted: false };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [
          {
            condition: {
              type: 'NotExpression',
              operand: { type: 'Identifier', name: 'deleted' },
            } as Expression,
            severity: 'error',
            message: 'Record is deleted',
          },
        ],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
    });
  });

  describe('empty constraints', () => {
    it('passes with no constraints', async () => {
      deps.ctx.response = { data: 'anything' };

      const step: ValidateStep = {
        type: 'ValidateStep',
        target: { type: 'Identifier', name: 'response' } as Expression,
        constraints: [],
      };

      const handler = new ValidateHandler(deps);
      await expect(handler.execute(step)).resolves.not.toThrow();
      expect(deps.log).toHaveBeenCalledWith('Validation passed');
    });
  });
});
