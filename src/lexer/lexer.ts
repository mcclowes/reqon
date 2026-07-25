/**
 * ---
 * purpose: Reqon lexer - extends Vague's lexer with Reqon-only operators
 * exports:
 *   - ReqonLexer - Vague Lexer plus `!=` / `!` operator support
 * related:
 *   - ./tokens.ts - ReqonTokenType.NOT_EQUALS / BANG
 *   - ../parser/expressions.ts - consumes NOT_EQUALS in comparisons
 *   - ../plugin.ts - registers Reqon keywords with Vague's lexer
 * ---
 *
 * Vague's plugin system lets us register keywords (identifiers) but not new
 * operator characters, and its lexer throws `Unexpected character '!'` on any
 * character it doesn't know. Reqon's parser, however, already understands the
 * `!=` (and bare `!`) operators. This subclass bridges that gap: it intercepts
 * operator scanning so a leading `!` produces the tokens the parser expects and
 * defers to Vague's lexer for everything else.
 */

import { Lexer as VagueLexer, type Token } from 'vague-lang';
import { ReqonTokenType } from './tokens.js';

// Private members of Vague's Lexer we need to reach at runtime. They are
// `private` in the type definitions but ordinary properties/methods on the
// prototype, so we describe them explicitly instead of reaching for `any`.
interface LexerInternals {
  line: number;
  column: number;
  peek(): string;
  advance(): string;
  readOperator(): Token;
}

const baseReadOperator = (VagueLexer.prototype as unknown as LexerInternals).readOperator;

/**
 * Reqon's lexer. Behaves exactly like Vague's lexer except that it also
 * tokenizes `!=` (NOT_EQUALS) and a bare `!` (BANG).
 */
export class ReqonLexer extends VagueLexer {}

// Override operator scanning on the Reqon subclass only, leaving Vague's shared
// Lexer.prototype untouched. `nextToken` dispatches through `this.readOperator`,
// so instances of ReqonLexer pick up this handler automatically.
(ReqonLexer.prototype as unknown as LexerInternals).readOperator = function (
  this: LexerInternals
): Token {
  if (this.peek() === '!') {
    const { line, column } = this;
    this.advance(); // consume '!'
    if (this.peek() === '=') {
      this.advance(); // consume '='
      return { type: ReqonTokenType.NOT_EQUALS, value: '!=', line, column } as unknown as Token;
    }
    return { type: ReqonTokenType.BANG, value: '!', line, column } as unknown as Token;
  }
  return baseReadOperator.call(this);
};
