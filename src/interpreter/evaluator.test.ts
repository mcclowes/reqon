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

    it('excludes (returns false) when a compared field is missing, instead of throwing', () => {
      const ctx = createContext();
      // `item.score > 5` where the item has no score — common in real API data.
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '>',
        left: { type: 'Identifier', name: 'score' },
        right: { type: 'Literal', value: 5, dataType: 'number' },
      };

      expect(() => evaluate(expr, ctx, { id: 1 })).not.toThrow();
      expect(evaluate(expr, ctx, { id: 1 })).toBe(false);
      expect(evaluate(expr, ctx, { score: 9 })).toBe(true);
    });
  });

  // Regression coverage for #248: comparisons used to coerce every operand
  // through Number(), so any non-numeric value became NaN and every ordering
  // comparison returned false. That silently broke `where .updated_at > lastSync`.
  describe('ordering comparisons (dates, strings, booleans)', () => {
    const ctx = createContext();
    const cmp = (left: unknown, right: unknown, operator: string): boolean =>
      evaluate(
        {
          type: 'BinaryExpression',
          operator,
          left: { type: 'Literal', value: left, dataType: 'string' },
          right: { type: 'Literal', value: right, dataType: 'string' },
        } as Expression,
        ctx
      ) as boolean;

    it('compares ISO-8601 date strings chronologically', () => {
      expect(cmp('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z', '>')).toBe(true);
      expect(cmp('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '>')).toBe(false);
      expect(cmp('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '<')).toBe(true);
      expect(cmp('2026-01-01', '2026-01-01', '>=')).toBe(true);
      expect(cmp('2026-01-01', '2026-01-01', '<=')).toBe(true);
    });

    it('orders bare dates against timestamps by instant, not by byte', () => {
      // Lexicographically '2026-01-02' > '2026-01-01T...'; chronologically too,
      // but the failure mode is a same-day timestamp vs bare date.
      expect(cmp('2026-01-01T12:00:00Z', '2026-01-01', '>')).toBe(true);
    });

    it('compares plain strings lexicographically', () => {
      expect(cmp('banana', 'apple', '>')).toBe(true);
      expect(cmp('banana', 'apple', '<')).toBe(false);
      expect(cmp('apple', 'banana', '<')).toBe(true);
      expect(cmp('apple', 'apple', '>=')).toBe(true);
    });

    it('compares numbers numerically', () => {
      const num = (l: number, r: number, op: string): boolean =>
        evaluate(
          {
            type: 'BinaryExpression',
            operator: op,
            left: { type: 'Literal', value: l, dataType: 'number' },
            right: { type: 'Literal', value: r, dataType: 'number' },
          } as Expression,
          ctx
        ) as boolean;
      expect(num(2, 10, '<')).toBe(true);
      expect(num(10, 2, '>')).toBe(true);
    });

    it('satisfies trichotomy: exactly one of <, ==, > holds for like-typed values', () => {
      const pairs: [unknown, unknown, 'string' | 'number'][] = [
        ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'string'],
        ['apple', 'banana', 'string'],
        ['apple', 'apple', 'string'],
        [3, 5, 'number'],
        [5, 5, 'number'],
      ];
      for (const [a, b, dataType] of pairs) {
        const bin = (op: string): boolean =>
          evaluate(
            {
              type: 'BinaryExpression',
              operator: op,
              left: { type: 'Literal', value: a, dataType },
              right: { type: 'Literal', value: b, dataType },
            } as Expression,
            ctx
          ) as boolean;
        const holds = [bin('<'), bin('=='), bin('>')].filter(Boolean).length;
        expect(holds).toBe(1);
      }
    });

    it('excludes (returns false) when either operand is absent', () => {
      const expr = (op: string): Expression =>
        ({
          type: 'BinaryExpression',
          operator: op,
          left: { type: 'Identifier', name: 'missing' },
          right: { type: 'Literal', value: '2026-01-01', dataType: 'string' },
        }) as Expression;
      expect(evaluate(expr('>'), ctx, {})).toBe(false);
      expect(evaluate(expr('<='), ctx, {})).toBe(false);
    });

    it('throws on a genuine type mismatch instead of matching nothing silently', () => {
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '>',
        left: { type: 'Literal', value: 5, dataType: 'number' },
        right: { type: 'Literal', value: 'apple', dataType: 'string' },
      } as Expression;
      expect(() => evaluate(expr, ctx)).toThrow(/Cannot compare/);
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

    it('or returns the left operand value when it is truthy', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'or',
        left: { type: 'Literal', value: 'value', dataType: 'string' },
        right: { type: 'Literal', value: 'default', dataType: 'string' },
      };

      expect(evaluate(expr, ctx)).toBe('value');
    });

    it('or returns the right operand value when the left is falsy (x or default)', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'or',
        left: { type: 'Literal', value: null, dataType: 'null' },
        right: { type: 'Literal', value: 'default', dataType: 'string' },
      };

      expect(evaluate(expr, ctx)).toBe('default');
    });

    it('and returns the right (last) operand value when both are truthy', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'and',
        left: { type: 'Literal', value: 'a', dataType: 'string' },
        right: { type: 'Literal', value: 'b', dataType: 'string' },
      };

      expect(evaluate(expr, ctx)).toBe('b');
    });

    it('and returns the falsy left operand value (short-circuit)', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'and',
        left: { type: 'Literal', value: 0, dataType: 'number' },
        right: { type: 'Literal', value: 'b', dataType: 'string' },
      };

      expect(evaluate(expr, ctx)).toBe(0);
    });

    it('does not evaluate the right operand of or when the left is truthy', () => {
      const ctx = createContext();
      // An unsupported operator would throw if evaluated; short-circuit avoids it.
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'or',
        left: { type: 'Literal', value: 'kept', dataType: 'string' },
        right: {
          type: 'BinaryExpression',
          operator: '???' as never,
          left: { type: 'Literal', value: 1, dataType: 'number' },
          right: { type: 'Literal', value: 1, dataType: 'number' },
        },
      };

      expect(evaluate(expr, ctx)).toBe('kept');
    });

    it('does not evaluate the right operand of and when the left is falsy', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'LogicalExpression',
        operator: 'and',
        left: { type: 'Literal', value: false, dataType: 'boolean' },
        right: {
          type: 'BinaryExpression',
          operator: '???' as never,
          left: { type: 'Literal', value: 1, dataType: 'number' },
          right: { type: 'Literal', value: 1, dataType: 'number' },
        },
      };

      expect(evaluate(expr, ctx)).toBe(false);
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
    it('env() reads a literal-named variable but rejects a dynamic argument', () => {
      const ctx = createContext();
      process.env.REQON_TEST_VAR = 'secret-value';
      try {
        const literal: Expression = {
          type: 'CallExpression',
          callee: 'env',
          arguments: [{ type: 'Literal', value: 'REQON_TEST_VAR', dataType: 'string' }],
        };
        expect(evaluate(literal, ctx)).toBe('secret-value');

        // A dynamic argument (data-driven var name) is refused — it would let
        // fetched data choose which env var to read.
        const dynamic: Expression = {
          type: 'CallExpression',
          callee: 'env',
          arguments: [{ type: 'Identifier', name: 'whichVar' }],
        };
        expect(() => evaluate(dynamic, ctx, { whichVar: 'REQON_TEST_VAR' })).toThrow();
      } finally {
        delete process.env.REQON_TEST_VAR;
      }
    });

    it('evaluates length function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'length',
        arguments: [
          {
            type: 'OrderedSequenceType',
            elements: [
              { type: 'Literal', value: 1, dataType: 'number' },
              { type: 'Literal', value: 2, dataType: 'number' },
              { type: 'Literal', value: 3, dataType: 'number' },
              { type: 'Literal', value: 4, dataType: 'number' },
              { type: 'Literal', value: 5, dataType: 'number' },
            ],
          },
        ],
      };

      expect(evaluate(expr, ctx)).toBe(5);
    });

    it('evaluates sum function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'sum',
        arguments: [
          {
            type: 'OrderedSequenceType',
            elements: [
              { type: 'Literal', value: 10, dataType: 'number' },
              { type: 'Literal', value: 20, dataType: 'number' },
              { type: 'Literal', value: 30, dataType: 'number' },
            ],
          },
        ],
      };

      expect(evaluate(expr, ctx)).toBe(60);
    });

    it('evaluates first function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'first',
        arguments: [
          {
            type: 'OrderedSequenceType',
            elements: [
              { type: 'Literal', value: 'a', dataType: 'string' },
              { type: 'Literal', value: 'b', dataType: 'string' },
              { type: 'Literal', value: 'c', dataType: 'string' },
            ],
          },
        ],
      };

      expect(evaluate(expr, ctx)).toBe('a');
    });

    it('evaluates last function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'last',
        arguments: [
          {
            type: 'OrderedSequenceType',
            elements: [
              { type: 'Literal', value: 'a', dataType: 'string' },
              { type: 'Literal', value: 'b', dataType: 'string' },
              { type: 'Literal', value: 'c', dataType: 'string' },
            ],
          },
        ],
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

    const rangeExpr = (...values: number[]): Expression => ({
      type: 'CallExpression',
      callee: 'range',
      arguments: values.map((value) => ({ type: 'Literal', value, dataType: 'number' })),
    });

    it('range(end) counts from 0 to end-1', () => {
      expect(evaluate(rangeExpr(5), createContext())).toEqual([0, 1, 2, 3, 4]);
    });

    it('range(start, end) is start-inclusive, end-exclusive', () => {
      expect(evaluate(rangeExpr(1, 6), createContext())).toEqual([1, 2, 3, 4, 5]);
    });

    it('range yields an empty array when start >= end', () => {
      expect(evaluate(rangeExpr(5, 5), createContext())).toEqual([]);
      expect(evaluate(rangeExpr(9, 3), createContext())).toEqual([]);
    });

    it('range produces a large sweep without an input file', () => {
      const result = evaluate(rangeExpr(1, 500001), createContext()) as number[];
      expect(result.length).toBe(500000);
      expect(result[0]).toBe(1);
      expect(result[result.length - 1]).toBe(500000);
    });

    it('range refuses a range past the safety cap', () => {
      expect(() => evaluate(rangeExpr(0, 20_000_001), createContext())).toThrow(/cap/);
    });

    const numLit = (value: number): Expression => ({
      type: 'Literal',
      value,
      dataType: 'number',
    });
    const strLit = (value: string): Expression => ({
      type: 'Literal',
      value,
      dataType: 'string',
    });

    it('abs returns the magnitude of a number', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'abs',
        arguments: [numLit(-42)],
      };
      expect(evaluate(expr, createContext())).toBe(42);
    });

    it('max returns the largest of its numeric arguments', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'max',
        arguments: [numLit(3), numLit(9), numLit(1)],
      };
      expect(evaluate(expr, createContext())).toBe(9);
    });

    it('min returns the smallest of its numeric arguments', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'min',
        arguments: [numLit(3), numLit(9), numLit(1)],
      };
      expect(evaluate(expr, createContext())).toBe(1);
    });

    it('max accepts a single array argument', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'max',
        arguments: [
          {
            type: 'OrderedSequenceType',
            elements: [numLit(4), numLit(2), numLit(7)],
          },
        ],
      };
      expect(evaluate(expr, createContext())).toBe(7);
    });

    it('max guards a divisor against zero (max(n, 1))', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'max',
        arguments: [numLit(0), numLit(1)],
      };
      expect(evaluate(expr, createContext())).toBe(1);
    });

    it('concat joins its arguments as strings, coercing numbers', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'concat',
        arguments: [strLit('order_'), numLit(42), strLit('_done')],
      };
      expect(evaluate(expr, createContext())).toBe('order_42_done');
    });

    it('concat renders null/undefined as empty string', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'concat',
        arguments: [strLit('a'), { type: 'Literal', value: null, dataType: 'null' }, strLit('b')],
      };
      expect(evaluate(expr, createContext())).toBe('ab');
    });

    it('parseNumber coerces a numeric string to a number', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'parseNumber',
        arguments: [strLit('99.99')],
      };
      expect(evaluate(expr, createContext())).toBe(99.99);
    });

    it('parseNumber returns null for an unparseable value', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'parseNumber',
        arguments: [strLit('not-a-number')],
      };
      expect(evaluate(expr, createContext())).toBeNull();
    });

    it('fromUnix converts epoch seconds to an ISO-8601 string', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'fromUnix',
        arguments: [numLit(1700000000)],
      };
      expect(evaluate(expr, createContext())).toBe('2023-11-14T22:13:20.000Z');
    });

    it('fromUnix returns null for a non-finite argument', () => {
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'fromUnix',
        arguments: [strLit('nope')],
      };
      expect(evaluate(expr, createContext())).toBeNull();
    });

    it('timestamp returns epoch milliseconds usable in arithmetic', () => {
      const before = Date.now();
      const expr: Expression = { type: 'CallExpression', callee: 'timestamp', arguments: [] };
      const result = evaluate(expr, createContext()) as number;
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(before);
    });

    it('throws on unknown function', () => {
      const ctx = createContext();
      const expr: Expression = {
        type: 'CallExpression',
        callee: 'unknownFn',
        arguments: [],
      };

      expect(() => evaluate(expr, ctx)).toThrow('Unsupported operation: function: unknownFn');
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

      expect(() => evaluate(expr as unknown as Expression, ctx)).toThrow(
        'Unsupported operation: type check: unknownType'
      );
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

  it('URL-encodes interpolated values so they cannot inject path or query', () => {
    const ctx = createContext();
    // A data-controlled id must not break out of its path segment.
    expect(interpolatePath('/users/{id}', ctx, { id: '1/../../admin' })).toBe(
      '/users/1%2F..%2F..%2Fadmin'
    );
    expect(interpolatePath('/users/{id}', ctx, { id: '1?role=admin' })).toBe(
      '/users/1%3Frole%3Dadmin'
    );
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

  it('falls back to a context variable for a dotted path the current item lacks', () => {
    const ctx = createContext();
    setVariable(ctx, 'org', { id: 'acme' });
    // `current` has no `org`; the root segment must resolve to the `org`
    // context variable and read its `.id`, not look up `id` as a standalone var.
    const current = { id: 'item-X' };

    const result = interpolatePath('/orgs/{org.id}/users', ctx, current);

    expect(result).toBe('/orgs/acme/users');
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
