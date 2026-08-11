import { describe, expect, it } from 'vitest';
import { ExpressionParser, Lexer } from 'vague-lang';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonExpressionParser } from './expressions.js';

function parseVagueExpression(source: string) {
  return new ExpressionParser(new Lexer(source).tokenize()).parseExpression();
}

function parseReqonExpression(source: string) {
  return new ReqonExpressionParser(new ReqonLexer(source).tokenize()).parseExpression();
}

/**
 * These are expressions owned by Vague rather than Reqon. Keeping the ASTs
 * identical lets Reqon consume new Vague releases without silently changing
 * precedence or runtime meaning.
 */
const sharedExpressions = [
  '42',
  'customer.name',
  '1 + 2 * 3',
  '(1 + 2) * 3',
  'amount >= 10 and status == "open"',
  'not archived or retries < 3',
  'enabled ? "yes" : "no"',
  '"draft" | 3: "active" | "closed"',
  '1..10',
  'length(items)',
  '[1, 2, 3]',
  'any of customers where active == true',
  'match status { "open" => 1, _ => 0 }',
] as const;

describe('Vague expression compatibility', () => {
  it.each(sharedExpressions)('matches Vague AST output for %s', (source) => {
    expect(parseReqonExpression(source)).toEqual(parseVagueExpression(source));
  });

  it('keeps Reqon-only expression extensions outside the shared contract', () => {
    const extensions = [
      'value is string',
      'value ?? "fallback"',
      '{ id: value, ...metadata }',
      'records[index]',
      'id in allowedIds',
    ];

    for (const source of extensions) {
      expect(() => parseReqonExpression(source)).not.toThrow();
    }
  });
});
