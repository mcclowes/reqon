import { describe, it, expect } from 'vitest';
import type { Expression } from 'vague-lang';
import { evaluate, evaluateToString, interpolatePath } from './evaluator.js';
import { createContext, childContext, setVariable } from './context.js';

describe('evaluate', () => {
  describe('literals', () => {
    it('evaluates number literal', () => {
      const ctx = createContext();
      const expr: Expression = { type: 'Literal', value: 42, dataType: 'number' };

      expect(evaluate(expr, ctx)).toBe(42);
    });

    it('evaluates string literal', () => {
      const ctx = createContext();
      const expr: Expression = { type: 'Literal', value: 'hello', dataType: 'string' };

      expect(evaluate(expr, ctx)).toBe('hello');
    });

    it('evaluates boolean literal', () => {
      const ctx = createContext();
      const trueExpr: Expression = { type: 'Literal', value: true, dataType: 'boolean' };
      const falseExpr: Expression = { type: 'Literal', value: false, dataType: 'boolean' };

      expect(evaluate(trueExpr, ctx)).toBe(true);
      expect(evaluate(falseExpr, ctx)).toBe(false);
    });

    it('evaluates null literal', () => {
      const ctx = createContext();
      const expr: Expression = { type: 'Literal', value: null, dataType: 'null' };

      expect(evaluate(expr, ctx)).toBe(null);
    });
  });

  describe('identifiers', () => {
    it('resolves variable from context', () => {
      const ctx = createContext();
      setVariable(ctx, 'myVar', 'hello');
      const expr: Expression = { type: 'Identifier', name: 'myVar' };

      expect(evaluate(expr, ctx)).toBe('hello');
    });

    it('resolves response special identifier', () => {
      const ctx = createContext();
      ctx.response = { data: 'test' };
      const expr: Expression = { type: 'Identifier', name: 'response' };

      expect(evaluate(expr, ctx)).toEqual({ data: 'test' });
    });

    it('resolves field from current object', () => {
      const ctx = createContext();
      const current = { name: 'Alice', age: 30 };
      const expr: Expression = { type: 'Identifier', name: 'name' };

      expect(evaluate(expr, ctx, current)).toBe('Alice');
    });

    it('resolves field from response when no current object', () => {
      const ctx = createContext();
      ctx.response = { name: 'Response Name' };
      const expr: Expression = { type: 'Identifier', name: 'name' };

      expect(evaluate(expr, ctx)).toBe('Response Name');
    });

    it('returns undefined for non-existent variable', () => {
      const ctx = createContext();
      const expr: Expression = { type: 'Identifier', name: 'nonExistent' };

      expect(evaluate(expr, ctx)).toBeUndefined();
    });
  });

  describe('qualified names (property access)', () => {
    it('resolves nested properties from current', () => {
      const ctx = createContext();
      const current = { user: { profile: { name: 'Alice' } } };
      const expr: Expression = {
        type: 'QualifiedName',
        parts: ['user', 'profile', 'name'],
      };

      expect(evaluate(expr, ctx, current)).toBe('Alice');
    });

    it('resolves from response when no current', () => {
      const ctx = createContext();
      ctx.response = { data: { items: [1, 2, 3] } };
      const expr: Expression = {
        type: 'QualifiedName',
        parts: ['data', 'items'],
      };

      expect(evaluate(expr, ctx)).toEqual([1, 2, 3]);
    });

    it('resolves from variables', () => {
      const ctx = createContext();
      setVariable(ctx, 'config', { settings: { theme: 'dark' } });
      const expr: Expression = {
        type: 'QualifiedName',
        parts: ['config', 'settings', 'theme'],
      };

      expect(evaluate(expr, ctx)).toBe('dark');
    });
  });

  describe('binary expressions', () => {
    it('evaluates addition', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Literal', value: 5, dataType: 'number' },
        right: { type: 'Literal', value: 3, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(8);
    });

    it('evaluates subtraction', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '-',
        left: { type: 'Literal', value: 10, dataType: 'number' },
        right: { type: 'Literal', value: 4, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(6);
    });

    it('evaluates multiplication', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '*',
        left: { type: 'Literal', value: 6, dataType: 'number' },
        right: { type: 'Literal', value: 7, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(42);
    });

    it('evaluates division', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '/',
        left: { type: 'Literal', value: 20, dataType: 'number' },
        right: { type: 'Literal', value: 4, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(5);
    });

    it('evaluates equality', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '==',
        left: { type: 'Literal', value: 5, dataType: 'number' },
        right: { type: 'Literal', value: 5, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });

    it('evaluates inequality', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '!=',
        left: { type: 'Literal', value: 5, dataType: 'number' },
        right: { type: 'Literal', value: 3, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });

    it('evaluates less than', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '<',
        left: { type: 'Literal', value: 3, dataType: 'number' },
        right: { type: 'Literal', value: 5, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });

    it('evaluates greater than or equal', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '>=',
        left: { type: 'Literal', value: 5, dataType: 'number' },
        right: { type: 'Literal', value: 5, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });
  });

  describe('logical expressions', () => {
    it('evaluates and (true && true)', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'and',
        left: { type: 'Literal', value: true, dataType: 'boolean' },
        right: { type: 'Literal', value: true, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });

    it('evaluates and (true && false)', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'and',
        left: { type: 'Literal', value: true, dataType: 'boolean' },
        right: { type: 'Literal', value: false, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(false);
    });

    it('short-circuits and on falsy left', () => {
      const ctx = createContext();
      // If short-circuiting works, the right side should not be evaluated
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'and',
        left: { type: 'Literal', value: false, dataType: 'boolean' },
        right: { type: 'Literal', value: true, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(false);
    });

    it('evaluates or (false || true)', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'or',
        left: { type: 'Literal', value: false, dataType: 'boolean' },
        right: { type: 'Literal', value: true, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });

    it('short-circuits or on truthy left', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'or',
        left: { type: 'Literal', value: true, dataType: 'boolean' },
        right: { type: 'Literal', value: false, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });
  });

  describe('not expression', () => {
    it('negates true to false', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'NotExpression',
        operand: { type: 'Literal', value: true, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(false);
    });

    it('negates false to true', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'NotExpression',
        operand: { type: 'Literal', value: false, dataType: 'boolean' },
      };

      expect(evaluate(expr, ctx)).toBe(true);
    });
  });

  describe('unary expressions', () => {
    it('negates a number', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'UnaryExpression',
        operator: '-',
        operand: { type: 'Literal', value: 5, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(-5);
    });

    it('positive unary has no effect', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'UnaryExpression',
        operator: '+',
        operand: { type: 'Literal', value: 5, dataType: 'number' },
      };

      expect(evaluate(expr, ctx)).toBe(5);
    });
  });

  describe('ternary expressions', () => {
    it('returns consequent when condition is true', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'TernaryExpression',
        condition: { type: 'Literal', value: true, dataType: 'boolean' },
        consequent: { type: 'Literal', value: 'yes', dataType: 'string' },
        alternate: { type: 'Literal', value: 'no', dataType: 'string' },
      };

      expect(evaluate(expr, ctx)).toBe('yes');
    });

    it('returns alternate when condition is false', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'TernaryExpression',
        condition: { type: 'Literal', value: false, dataType: 'boolean' },
        consequent: { type: 'Literal', value: 'yes', dataType: 'string' },
        alternate: { type: 'Literal', value: 'no', dataType: 'string' },
      };

      expect(evaluate(expr, ctx)).toBe('no');
    });
  });

  describe('match expressions', () => {
    it('matches value and returns result', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'MatchExpression',
        value: { type: 'Literal', value: 'A', dataType: 'string' },
        arms: [
          {
            pattern: { type: 'Literal', value: 'A', dataType: 'string' },
            result: { type: 'Literal', value: 'active', dataType: 'string' },
          },
          {
            pattern: { type: 'Literal', value: 'I', dataType: 'string' },
            result: { type: 'Literal', value: 'inactive', dataType: 'string' },
          },
        ],
      };

      expect(evaluate(expr, ctx)).toBe('active');
    });

    it('matches wildcard pattern', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'MatchExpression',
        value: { type: 'Literal', value: 'X', dataType: 'string' },
        arms: [
          {
            pattern: { type: 'Literal', value: 'A', dataType: 'string' },
            result: { type: 'Literal', value: 'active', dataType: 'string' },
          },
          {
            pattern: { type: 'Identifier', name: '_' },
            result: { type: 'Literal', value: 'unknown', dataType: 'string' },
          },
        ],
      };

      expect(evaluate(expr, ctx)).toBe('unknown');
    });

    it('returns undefined when no match', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'MatchExpression',
        value: { type: 'Literal', value: 'X', dataType: 'string' },
        arms: [
          {
            pattern: { type: 'Literal', value: 'A', dataType: 'string' },
            result: { type: 'Literal', value: 'active', dataType: 'string' },
          },
        ],
      };

      expect(evaluate(expr, ctx)).toBeUndefined();
    });
  });

  describe('call expressions (built-in functions)', () => {
    it('evaluates length function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'length',
        arguments: [{
          type: 'OrderedSequenceType',
          elements: [
            { type: 'Literal', value: 1, dataType: 'number' },
            { type: 'Literal', value: 2, dataType: 'number' },
            { type: 'Literal', value: 3, dataType: 'number' },
            { type: 'Literal', value: 4, dataType: 'number' },
            { type: 'Literal', value: 5, dataType: 'number' },
          ],
        }],
      };

      expect(evaluate(expr, ctx)).toBe(5);
    });

    it('evaluates sum function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'sum',
        arguments: [{
          type: 'OrderedSequenceType',
          elements: [
            { type: 'Literal', value: 10, dataType: 'number' },
            { type: 'Literal', value: 20, dataType: 'number' },
            { type: 'Literal', value: 30, dataType: 'number' },
          ],
        }],
      };

      expect(evaluate(expr, ctx)).toBe(60);
    });

    it('evaluates first function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'first',
        arguments: [{
          type: 'OrderedSequenceType',
          elements: [
            { type: 'Literal', value: 'a', dataType: 'string' },
            { type: 'Literal', value: 'b', dataType: 'string' },
            { type: 'Literal', value: 'c', dataType: 'string' },
          ],
        }],
      };

      expect(evaluate(expr, ctx)).toBe('a');
    });

    it('evaluates last function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'last',
        arguments: [{
          type: 'OrderedSequenceType',
          elements: [
            { type: 'Literal', value: 'a', dataType: 'string' },
            { type: 'Literal', value: 'b', dataType: 'string' },
            { type: 'Literal', value: 'c', dataType: 'string' },
          ],
        }],
      };

      expect(evaluate(expr, ctx)).toBe('c');
    });

    it('evaluates round function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'round',
        arguments: [{ type: 'Literal', value: 3.7, dataType: 'number' }],
      };

      expect(evaluate(expr, ctx)).toBe(4);
    });

    it('evaluates floor function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'floor',
        arguments: [{ type: 'Literal', value: 3.9, dataType: 'number' }],
      };

      expect(evaluate(expr, ctx)).toBe(3);
    });

    it('evaluates ceil function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'ceil',
        arguments: [{ type: 'Literal', value: 3.1, dataType: 'number' }],
      };

      expect(evaluate(expr, ctx)).toBe(4);
    });

    it('throws on unknown function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'unknownFn',
        arguments: [],
      };

      expect(() => evaluate(expr, ctx)).toThrow('Unknown function: unknownFn');
    });
  });

  describe('is expressions (type checking)', () => {
    it('checks is array - true case', () => {
      const ctx = createContext();
      ctx.response = [1, 2, 3];
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'response' },
        typeCheck: 'array',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is array - false case', () => {
      const ctx = createContext();
      ctx.response = { items: [1, 2, 3] };
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'response' },
        typeCheck: 'array',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(false);
    });

    it('checks is object - true case', () => {
      const ctx = createContext();
      ctx.response = { name: 'test' };
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'response' },
        typeCheck: 'object',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is object - false for array', () => {
      const ctx = createContext();
      ctx.response = [1, 2, 3];
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'response' },
        typeCheck: 'object',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(false);
    });

    it('checks is string', () => {
      const ctx = createContext();
      setVariable(ctx, 'name', 'Alice');
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'name' },
        typeCheck: 'string',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is number', () => {
      const ctx = createContext();
      setVariable(ctx, 'count', 42);
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'count' },
        typeCheck: 'number',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is int - true for integer', () => {
      const ctx = createContext();
      setVariable(ctx, 'value', 42);
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'value' },
        typeCheck: 'int',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is int - false for decimal', () => {
      const ctx = createContext();
      setVariable(ctx, 'value', 42.5);
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'value' },
        typeCheck: 'int',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(false);
    });

    it('checks is boolean', () => {
      const ctx = createContext();
      setVariable(ctx, 'flag', true);
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'flag' },
        typeCheck: 'boolean',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is null', () => {
      const ctx = createContext();
      setVariable(ctx, 'value', null);
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'value' },
        typeCheck: 'null',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is undefined', () => {
      const ctx = createContext();
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'nonExistent' },
        typeCheck: 'undefined',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is date - Date object', () => {
      const ctx = createContext();
      setVariable(ctx, 'timestamp', new Date());
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'timestamp' },
        typeCheck: 'date',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('checks is date - ISO string', () => {
      const ctx = createContext();
      setVariable(ctx, 'timestamp', '2025-01-15T10:30:00Z');
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'timestamp' },
        typeCheck: 'date',
      };

      expect(evaluate(expr as unknown as Expression, ctx)).toBe(true);
    });

    it('throws on unknown type', () => {
      const ctx = createContext();
      setVariable(ctx, 'value', 'test');
      const expr = {
        type: 'IsExpression',
        operand: { type: 'Identifier', name: 'value' },
        typeCheck: 'unknownType',
      };

      expect(() => evaluate(expr as unknown as Expression, ctx)).toThrow("Unknown type for 'is' check: unknownType");
    });
  });
});

describe('evaluateToString', () => {
  it('converts number to string', () => {
    const ctx = createContext();
    const expr: Expression = { type: 'Literal', value: 42, dataType: 'number' };

    expect(evaluateToString(expr, ctx)).toBe('42');
  });

  it('converts null to empty string', () => {
    const ctx = createContext();
    const expr: Expression = { type: 'Literal', value: null, dataType: 'null' };

    expect(evaluateToString(expr, ctx)).toBe('');
  });

  it('converts undefined to empty string', () => {
    const ctx = createContext();
    const expr: Expression = { type: 'Identifier', name: 'nonExistent' };

    expect(evaluateToString(expr, ctx)).toBe('');
  });
});

describe('interpolatePath', () => {
  it('interpolates simple variables', () => {
    const ctx = createContext();
    const current = { id: '123' };

    const result = interpolatePath('/users/{id}', ctx, current);

    expect(result).toBe('/users/123');
  });

  it('interpolates nested properties', () => {
    const ctx = createContext();
    const current = { user: { profile: { id: 'abc' } } };

    const result = interpolatePath('/profiles/{user.profile.id}', ctx, current);

    expect(result).toBe('/profiles/abc');
  });

  it('interpolates from context variables', () => {
    const ctx = createContext();
    setVariable(ctx, 'userId', '456');

    const result = interpolatePath('/users/{userId}', ctx);

    expect(result).toBe('/users/456');
  });

  it('handles multiple interpolations', () => {
    const ctx = createContext();
    const current = { org: 'acme', project: 'widget' };

    const result = interpolatePath('/orgs/{org}/projects/{project}', ctx, current);

    expect(result).toBe('/orgs/acme/projects/widget');
  });

  it('handles missing values as empty string', () => {
    const ctx = createContext();

    const result = interpolatePath('/users/{nonExistent}', ctx, {});

    expect(result).toBe('/users/');
  });
});

describe('context variable resolution', () => {
  it('resolves variables from parent context', () => {
    const parent = createContext();
    setVariable(parent, 'parentVar', 'from parent');

    const child = childContext(parent);
    const expr: Expression = { type: 'Identifier', name: 'parentVar' };

    expect(evaluate(expr, child)).toBe('from parent');
  });

  it('child variables shadow parent variables', () => {
    const parent = createContext();
    setVariable(parent, 'sharedVar', 'parent value');

    const child = childContext(parent);
    setVariable(child, 'sharedVar', 'child value');

    const expr: Expression = { type: 'Identifier', name: 'sharedVar' };

    expect(evaluate(expr, child)).toBe('child value');
    expect(evaluate(expr, parent)).toBe('parent value');
  });

  it('shares stores between parent and child', () => {
    const parent = createContext();
    const child = childContext(parent);

    expect(child.stores).toBe(parent.stores);
    expect(child.sources).toBe(parent.sources);
  });
});
