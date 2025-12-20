import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonExpressionParser } from './expressions.js';
import type { ReqonToken } from '../lexer/tokens.js';

describe('ReqonExpressionParser', () => {
  function parseExpr(source: string) {
    const lexer = new ReqonLexer(source);
    const tokens = lexer.tokenize();
    const parser = new TestableExpressionParser(tokens);
    return parser.parseExpression();
  }

  // Create a testable subclass that exposes parseExpression
  class TestableExpressionParser extends ReqonExpressionParser {
    constructor(tokens: ReqonToken[]) {
      super(tokens);
    }
  }

  describe('literals', () => {
    it('parses number literals', () => {
      const expr = parseExpr('42');

      expect(expr.type).toBe('Literal');
      if (expr.type === 'Literal') {
        expect(expr.value).toBe(42);
        expect(expr.dataType).toBe('number');
      }
    });

    it('parses decimal number literals', () => {
      const expr = parseExpr('3.14');

      expect(expr.type).toBe('Literal');
      if (expr.type === 'Literal') {
        expect(expr.value).toBe(3.14);
      }
    });

    it('parses string literals', () => {
      const expr = parseExpr('"hello world"');

      expect(expr.type).toBe('Literal');
      if (expr.type === 'Literal') {
        expect(expr.value).toBe('hello world');
        expect(expr.dataType).toBe('string');
      }
    });

    it('parses true literal', () => {
      const expr = parseExpr('true');

      expect(expr.type).toBe('Literal');
      if (expr.type === 'Literal') {
        expect(expr.value).toBe(true);
        expect(expr.dataType).toBe('boolean');
      }
    });

    it('parses false literal', () => {
      const expr = parseExpr('false');

      expect(expr.type).toBe('Literal');
      if (expr.type === 'Literal') {
        expect(expr.value).toBe(false);
        expect(expr.dataType).toBe('boolean');
      }
    });

    it('parses null literal', () => {
      const expr = parseExpr('null');

      expect(expr.type).toBe('Literal');
      if (expr.type === 'Literal') {
        expect(expr.value).toBe(null);
        expect(expr.dataType).toBe('null');
      }
    });
  });

  describe('identifiers', () => {
    it('parses simple identifiers', () => {
      const expr = parseExpr('myVariable');

      expect(expr.type).toBe('Identifier');
      if (expr.type === 'Identifier') {
        expect(expr.name).toBe('myVariable');
      }
    });

    it('parses dot-prefixed field shorthand', () => {
      const expr = parseExpr('.fieldName');

      expect(expr.type).toBe('Identifier');
      if (expr.type === 'Identifier') {
        expect(expr.name).toBe('fieldName');
      }
    });
  });

  describe('binary arithmetic expressions', () => {
    it('parses addition', () => {
      const expr = parseExpr('1 + 2');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('+');
        expect(expr.left).toMatchObject({ type: 'Literal', value: 1 });
        expect(expr.right).toMatchObject({ type: 'Literal', value: 2 });
      }
    });

    it('parses subtraction', () => {
      const expr = parseExpr('10 - 5');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('-');
      }
    });

    it('parses multiplication', () => {
      const expr = parseExpr('3 * 4');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('*');
      }
    });

    it('parses division', () => {
      const expr = parseExpr('20 / 4');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('/');
      }
    });

    it('respects operator precedence (multiplication before addition)', () => {
      const expr = parseExpr('1 + 2 * 3');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('+');
        expect(expr.left).toMatchObject({ type: 'Literal', value: 1 });
        expect(expr.right.type).toBe('BinaryExpression');
        if (expr.right.type === 'BinaryExpression') {
          expect(expr.right.operator).toBe('*');
        }
      }
    });

    it('respects parentheses', () => {
      const expr = parseExpr('(1 + 2) * 3');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('*');
        expect(expr.left.type).toBe('BinaryExpression');
        expect(expr.right).toMatchObject({ type: 'Literal', value: 3 });
      }
    });
  });

  describe('comparison expressions', () => {
    it('parses equality', () => {
      const expr = parseExpr('x == 5');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('==');
      }
    });

    it('parses less than', () => {
      const expr = parseExpr('x < 10');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('<');
      }
    });

    it('parses greater than', () => {
      const expr = parseExpr('x > 0');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('>');
      }
    });

    it('parses less than or equal', () => {
      const expr = parseExpr('x <= 100');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('<=');
      }
    });

    it('parses greater than or equal', () => {
      const expr = parseExpr('x >= 0');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('>=');
      }
    });
  });

  describe('logical expressions', () => {
    it('parses and expression', () => {
      const expr = parseExpr('a and b');

      expect(expr.type).toBe('LogicalExpression');
      if (expr.type === 'LogicalExpression') {
        expect(expr.operator).toBe('and');
      }
    });

    it('parses or expression', () => {
      const expr = parseExpr('a or b');

      expect(expr.type).toBe('LogicalExpression');
      if (expr.type === 'LogicalExpression') {
        expect(expr.operator).toBe('or');
      }
    });

    it('parses not expression', () => {
      const expr = parseExpr('not a');

      expect(expr.type).toBe('NotExpression');
      if (expr.type === 'NotExpression') {
        expect(expr.operand).toMatchObject({ type: 'Identifier', name: 'a' });
      }
    });

    it('parses combined logical expressions', () => {
      const expr = parseExpr('a and b or c');

      // 'or' has lower precedence, so it's the root
      expect(expr.type).toBe('LogicalExpression');
      if (expr.type === 'LogicalExpression') {
        expect(expr.operator).toBe('or');
        expect(expr.left.type).toBe('LogicalExpression');
        if (expr.left.type === 'LogicalExpression') {
          expect(expr.left.operator).toBe('and');
        }
      }
    });

    it('parses double negation', () => {
      const expr = parseExpr('not not a');

      expect(expr.type).toBe('NotExpression');
      if (expr.type === 'NotExpression') {
        expect(expr.operand.type).toBe('NotExpression');
      }
    });
  });

  describe('ternary expressions', () => {
    it('parses simple ternary', () => {
      const expr = parseExpr('true ? 1 : 0');

      expect(expr.type).toBe('TernaryExpression');
      if (expr.type === 'TernaryExpression') {
        expect(expr.condition).toMatchObject({ type: 'Literal', value: true });
        expect(expr.consequent).toMatchObject({ type: 'Literal', value: 1 });
        expect(expr.alternate).toMatchObject({ type: 'Literal', value: 0 });
      }
    });

    it('parses nested ternary', () => {
      const expr = parseExpr('a ? b ? 1 : 2 : 3');

      expect(expr.type).toBe('TernaryExpression');
      if (expr.type === 'TernaryExpression') {
        expect(expr.consequent.type).toBe('TernaryExpression');
      }
    });
  });

  describe('unary expressions', () => {
    it('parses negative number', () => {
      const expr = parseExpr('-5');

      expect(expr.type).toBe('UnaryExpression');
      if (expr.type === 'UnaryExpression') {
        expect(expr.operator).toBe('-');
        expect(expr.operand).toMatchObject({ type: 'Literal', value: 5 });
      }
    });

    it('parses positive number', () => {
      const expr = parseExpr('+5');

      expect(expr.type).toBe('UnaryExpression');
      if (expr.type === 'UnaryExpression') {
        expect(expr.operator).toBe('+');
      }
    });

    it('parses double negative', () => {
      const expr = parseExpr('--x');

      expect(expr.type).toBe('UnaryExpression');
      if (expr.type === 'UnaryExpression') {
        expect(expr.operand.type).toBe('UnaryExpression');
      }
    });
  });

  describe('member access (qualified names)', () => {
    it('parses single property access', () => {
      const expr = parseExpr('obj.prop');

      expect(expr.type).toBe('QualifiedName');
      if (expr.type === 'QualifiedName') {
        expect(expr.parts).toEqual(['obj', 'prop']);
      }
    });

    it('parses chained property access', () => {
      const expr = parseExpr('a.b.c.d');

      expect(expr.type).toBe('QualifiedName');
      if (expr.type === 'QualifiedName') {
        expect(expr.parts).toEqual(['a', 'b', 'c', 'd']);
      }
    });
  });

  describe('function calls', () => {
    it('parses function call without arguments', () => {
      const expr = parseExpr('fn()');

      expect(expr.type).toBe('CallExpression');
      if (expr.type === 'CallExpression') {
        expect(expr.callee).toBe('fn');
        expect(expr.arguments).toEqual([]);
      }
    });

    it('parses function call with single argument', () => {
      const expr = parseExpr('length(items)');

      expect(expr.type).toBe('CallExpression');
      if (expr.type === 'CallExpression') {
        expect(expr.callee).toBe('length');
        expect(expr.arguments).toHaveLength(1);
      }
    });

    it('parses function call with multiple arguments', () => {
      const expr = parseExpr('func(1, 2, 3)');

      expect(expr.type).toBe('CallExpression');
      if (expr.type === 'CallExpression') {
        expect(expr.arguments).toHaveLength(3);
      }
    });
  });

  describe('match expressions', () => {
    it('parses simple match expression', () => {
      const expr = parseExpr('match x { 1 => "one", 2 => "two" }');

      expect(expr.type).toBe('MatchExpression');
      if (expr.type === 'MatchExpression') {
        expect(expr.arms).toHaveLength(2);
        expect(expr.arms[0].pattern).toMatchObject({ type: 'Literal', value: 1 });
        expect(expr.arms[0].result).toMatchObject({ type: 'Literal', value: 'one' });
      }
    });

    it('parses match with wildcard', () => {
      const expr = parseExpr('match status { "A" => "active", _ => "other" }');

      expect(expr.type).toBe('MatchExpression');
      if (expr.type === 'MatchExpression') {
        expect(expr.arms).toHaveLength(2);
        expect(expr.arms[1].pattern).toMatchObject({ type: 'Identifier', name: '_' });
      }
    });
  });

  describe('any of expressions', () => {
    it('parses any of expression', () => {
      const expr = parseExpr('any of items');

      expect(expr.type).toBe('AnyOfExpression');
      if (expr.type === 'AnyOfExpression') {
        expect(expr.collection).toMatchObject({ type: 'Identifier', name: 'items' });
        expect(expr.condition).toBeUndefined();
      }
    });

    it('parses any of with where condition', () => {
      const expr = parseExpr('any of items where active');

      expect(expr.type).toBe('AnyOfExpression');
      if (expr.type === 'AnyOfExpression') {
        expect(expr.condition).toBeDefined();
      }
    });
  });

  describe('range expressions', () => {
    it('parses range expression', () => {
      const expr = parseExpr('1..10');

      expect(expr.type).toBe('RangeExpression');
      if (expr.type === 'RangeExpression') {
        expect(expr.min).toMatchObject({ type: 'Literal', value: 1 });
        expect(expr.max).toMatchObject({ type: 'Literal', value: 10 });
      }
    });

    it('parses open-ended range', () => {
      const expr = parseExpr('5..');

      expect(expr.type).toBe('RangeExpression');
      if (expr.type === 'RangeExpression') {
        expect(expr.min).toMatchObject({ type: 'Literal', value: 5 });
        expect(expr.max).toBeUndefined();
      }
    });
  });

  describe('complex expressions', () => {
    it('parses complex arithmetic with comparisons', () => {
      const expr = parseExpr('(a + b) * 2 > 100');

      expect(expr.type).toBe('BinaryExpression');
      if (expr.type === 'BinaryExpression') {
        expect(expr.operator).toBe('>');
      }
    });

    it('parses logical expression with comparisons', () => {
      const expr = parseExpr('x > 0 and x < 100');

      expect(expr.type).toBe('LogicalExpression');
      if (expr.type === 'LogicalExpression') {
        expect(expr.operator).toBe('and');
        expect(expr.left.type).toBe('BinaryExpression');
        expect(expr.right.type).toBe('BinaryExpression');
      }
    });

    it('parses ternary with function call', () => {
      const expr = parseExpr('length(items) > 0 ? first(items) : null');

      expect(expr.type).toBe('TernaryExpression');
      if (expr.type === 'TernaryExpression') {
        expect(expr.condition.type).toBe('BinaryExpression');
        expect(expr.consequent.type).toBe('CallExpression');
        expect(expr.alternate).toMatchObject({ type: 'Literal', value: null });
      }
    });
  });
});
