/**
 * End-to-end tests (lex -> parse -> evaluate) for the expression operators added
 * to close the README feature-index gap: `??` nullish coalescing, `...` object
 * spread, `in` membership, and `[]` subscript indexing.
 */
import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonExpressionParser } from '../parser/expressions.js';
import type { ReqonToken } from '../lexer/tokens.js';
import { evaluate } from './evaluator.js';
import { createContext, setVariable } from './context.js';
import type { ExecutionContext } from './context.js';

class TestableExpressionParser extends ReqonExpressionParser {
  constructor(tokens: ReqonToken[]) {
    super(tokens);
  }
}

function evalExpr(source: string, ctx: ExecutionContext, current?: unknown): unknown {
  const tokens = new ReqonLexer(source).tokenize();
  const expr = new TestableExpressionParser(tokens).parseExpression();
  return evaluate(expr, ctx, current);
}

describe('nullish coalescing (??)', () => {
  it('returns the fallback when the left side is null', () => {
    const ctx = createContext();
    setVariable(ctx, 'name', null);
    expect(evalExpr('name ?? "Anon"', ctx)).toBe('Anon');
  });

  it('returns the fallback when the left side is undefined', () => {
    const ctx = createContext();
    expect(evalExpr('missing ?? "default"', ctx)).toBe('default');
  });

  it('keeps a falsy-but-defined left side (0, empty string, false)', () => {
    const ctx = createContext();
    setVariable(ctx, 'zero', 0);
    setVariable(ctx, 'empty', '');
    setVariable(ctx, 'flag', false);
    expect(evalExpr('zero ?? 99', ctx)).toBe(0);
    expect(evalExpr('empty ?? "x"', ctx)).toBe('');
    expect(evalExpr('flag ?? true', ctx)).toBe(false);
  });

  it('differs from `or`, which falls back on any falsy value', () => {
    const ctx = createContext();
    setVariable(ctx, 'zero', 0);
    expect(evalExpr('zero ?? 99', ctx)).toBe(0);
    expect(evalExpr('zero or 99', ctx)).toBe(99);
  });

  it('short-circuits and does not evaluate the right side when left is present', () => {
    const ctx = createContext();
    setVariable(ctx, 'present', 'here');
    // The right side would divide by zero if evaluated.
    expect(evalExpr('present ?? (1 / 0)', ctx)).toBe('here');
  });

  it('chains left-to-right', () => {
    const ctx = createContext();
    setVariable(ctx, 'a', null);
    setVariable(ctx, 'b', null);
    setVariable(ctx, 'c', 'third');
    expect(evalExpr('a ?? b ?? c', ctx)).toBe('third');
  });
});

describe('object spread (...)', () => {
  it('merges a source object into the literal', () => {
    const ctx = createContext();
    setVariable(ctx, 'original', { a: 1, b: 2 });
    expect(evalExpr('{ ...original, c: 3 }', ctx)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('lets later explicit properties override spread values', () => {
    const ctx = createContext();
    setVariable(ctx, 'original', { a: 1, b: 2 });
    expect(evalExpr('{ ...original, b: 20 }', ctx)).toEqual({ a: 1, b: 20 });
  });

  it('lets a later spread override an earlier one', () => {
    const ctx = createContext();
    setVariable(ctx, 'base', { a: 1, b: 2 });
    setVariable(ctx, 'override', { b: 9 });
    expect(evalExpr('{ ...base, ...override }', ctx)).toEqual({ a: 1, b: 9 });
  });

  it('contributes nothing when the spread source is not an object', () => {
    const ctx = createContext();
    setVariable(ctx, 'missing', null);
    expect(evalExpr('{ ...missing, a: 1 }', ctx)).toEqual({ a: 1 });
  });

  it('works with a computed property alongside the spread', () => {
    const ctx = createContext();
    setVariable(ctx, 'order', { id: 5, total: 100 });
    expect(evalExpr('{ ...order, doubled: total * 2 }', ctx, { total: 100 })).toEqual({
      id: 5,
      total: 100,
      doubled: 200,
    });
  });
});

describe('membership (in)', () => {
  it('tests array membership by value', () => {
    const ctx = createContext();
    setVariable(ctx, 'ids', [1, 2, 3]);
    expect(evalExpr('2 in ids', ctx)).toBe(true);
    expect(evalExpr('9 in ids', ctx)).toBe(false);
  });

  it('tests substring membership for strings', () => {
    const ctx = createContext();
    expect(evalExpr('"dm" in "admin"', ctx)).toBe(true);
    expect(evalExpr('"xyz" in "admin"', ctx)).toBe(false);
  });

  it('tests own-key presence for objects', () => {
    const ctx = createContext();
    setVariable(ctx, 'obj', { active: true });
    expect(evalExpr('"active" in obj', ctx)).toBe(true);
    expect(evalExpr('"missing" in obj', ctx)).toBe(false);
  });

  it('returns false for non-collection right operands', () => {
    const ctx = createContext();
    setVariable(ctx, 'num', 5);
    expect(evalExpr('1 in num', ctx)).toBe(false);
  });

  it('composes inside a boolean guard', () => {
    const ctx = createContext();
    setVariable(ctx, 'allowed', ['admin', 'owner']);
    expect(evalExpr('"admin" in allowed and true', ctx)).toBe(true);
  });
});

describe('subscript indexing ([])', () => {
  it('indexes object properties with a static string key', () => {
    const ctx = createContext();
    setVariable(ctx, 'cache', { x: 'X', y: 'Y' });
    expect(evalExpr('cache["x"]', ctx)).toBe('X');
  });

  it('indexes object properties with a dynamic key', () => {
    const ctx = createContext();
    setVariable(ctx, 'cache', { alpha: 1, beta: 2 });
    setVariable(ctx, 'field', 'beta');
    expect(evalExpr('cache[field]', ctx)).toBe(2);
  });

  it('indexes arrays by numeric position', () => {
    const ctx = createContext();
    setVariable(ctx, 'ids', [10, 20, 30]);
    expect(evalExpr('ids[0]', ctx)).toBe(10);
    expect(evalExpr('ids[2]', ctx)).toBe(30);
  });

  it('supports negative array indices from the end', () => {
    const ctx = createContext();
    setVariable(ctx, 'ids', [10, 20, 30]);
    expect(evalExpr('ids[-1]', ctx)).toBe(30);
  });

  it('indexes strings by character position', () => {
    const ctx = createContext();
    setVariable(ctx, 's', 'hello');
    expect(evalExpr('s[0]', ctx)).toBe('h');
  });

  it('returns undefined when indexing a non-indexable value', () => {
    const ctx = createContext();
    setVariable(ctx, 'num', 5);
    expect(evalExpr('num["x"]', ctx)).toBeUndefined();
  });

  it('allows dotted property access after a subscript', () => {
    const ctx = createContext();
    setVariable(ctx, 'rows', [{ name: 'first' }, { name: 'second' }]);
    expect(evalExpr('rows[1].name', ctx)).toBe('second');
  });

  it('chains subscripts', () => {
    const ctx = createContext();
    setVariable(ctx, 'matrix', [
      [1, 2],
      [3, 4],
    ]);
    expect(evalExpr('matrix[1][0]', ctx)).toBe(3);
  });
});

describe('match expression with where-guards', () => {
  const tierExpr = `match score {
    s where s >= 800 => "excellent",
    s where s >= 700 => "good",
    s where s >= 500 => "fair",
    _ => "high_risk"
  }`;

  it('takes the first guard that holds (binding the matched value)', () => {
    const ctx = createContext();
    setVariable(ctx, 'score', 850);
    expect(evalExpr(tierExpr, ctx)).toBe('excellent');
  });

  it('falls through to a later guard', () => {
    const ctx = createContext();
    setVariable(ctx, 'score', 720);
    expect(evalExpr(tierExpr, ctx)).toBe('good');
  });

  it('falls back to the wildcard when no guard holds', () => {
    const ctx = createContext();
    setVariable(ctx, 'score', 100);
    expect(evalExpr(tierExpr, ctx)).toBe('high_risk');
  });

  it('still evaluates unguarded literal-equality arms', () => {
    const ctx = createContext();
    expect(
      evalExpr('match state { "open" => "O", "closed" => "C", _ => "?" }', ctx, { state: 'closed' })
    ).toBe('C');
  });

  it('still evaluates unguarded boolean-expression arms against match true', () => {
    const ctx = createContext();
    setVariable(ctx, 'n', 5);
    expect(evalExpr('match true { (n > 3) => "big", _ => "small" }', ctx)).toBe('big');
  });

  it('exposes outer fields alongside the binding inside a guard', () => {
    const ctx = createContext();
    // The guard sees both the binding `v` and the surrounding `current` record.
    expect(
      evalExpr('match amount { v where v > threshold => "over", _ => "ok" }', ctx, {
        amount: 50,
        threshold: 10,
      })
    ).toBe('over');
  });
});
