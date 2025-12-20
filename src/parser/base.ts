import { TokenType } from 'vague-lang';
import type { ReqonToken, TokenType as CombinedTokenType } from '../lexer/tokens.js';
import { ReqonTokenType } from '../lexer/tokens.js';
import { ParseError, type ErrorContext } from '../errors/index.js';

export class ReqonParserBase {
  protected tokens: ReqonToken[];
  protected pos = 0;
  protected source?: string;
  protected filePath?: string;

  constructor(tokens: ReqonToken[], source?: string, filePath?: string) {
    this.tokens = tokens.filter((t) => t.type !== TokenType.NEWLINE);
    this.source = source;
    this.filePath = filePath;
  }

  protected peek(): ReqonToken {
    return this.tokens[this.pos];
  }

  protected peekNext(): ReqonToken | undefined {
    return this.tokens[this.pos + 1];
  }

  protected check(type: CombinedTokenType): boolean {
    return !this.isAtEnd() && this.peek().type === type;
  }

  protected checkAny(...types: CombinedTokenType[]): boolean {
    return types.some((t) => this.check(t));
  }

  protected match(type: CombinedTokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  protected matchAny(...types: CombinedTokenType[]): CombinedTokenType | null {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return type;
      }
    }
    return null;
  }

  protected advance(): ReqonToken {
    if (!this.isAtEnd()) this.pos++;
    return this.tokens[this.pos - 1];
  }

  protected consume(type: CombinedTokenType, message: string): ReqonToken {
    if (this.check(type)) return this.advance();
    throw this.error(message);
  }

  /**
   * Consume an identifier, allowing HTTP method tokens to be used as identifiers.
   * This is needed because 'get', 'post', etc. are valid variable/store names.
   */
  protected consumeIdentifier(message: string): ReqonToken {
    const token = this.peek();
    // Accept both regular identifiers and HTTP method tokens as identifiers
    if (
      token.type === TokenType.IDENTIFIER ||
      token.type === ReqonTokenType.GET ||
      token.type === ReqonTokenType.POST ||
      token.type === ReqonTokenType.PUT ||
      token.type === ReqonTokenType.PATCH ||
      token.type === ReqonTokenType.DELETE
    ) {
      return this.advance();
    }
    throw this.error(message);
  }

  /**
   * Check if current token is an identifier (including HTTP methods as identifiers)
   */
  protected checkIdentifier(): boolean {
    const type = this.peek().type;
    return (
      type === TokenType.IDENTIFIER ||
      type === ReqonTokenType.GET ||
      type === ReqonTokenType.POST ||
      type === ReqonTokenType.PUT ||
      type === ReqonTokenType.PATCH ||
      type === ReqonTokenType.DELETE
    );
  }

  protected isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  protected error(message: string): ParseError {
    const token = this.peek();
    const context: ErrorContext | undefined = this.source
      ? { source: this.source, filePath: this.filePath }
      : undefined;

    return new ParseError(
      message,
      { line: token.line, column: token.column },
      context,
      token.value
    );
  }

  protected savePosition(): number {
    return this.pos;
  }

  protected restorePosition(saved: number): void {
    this.pos = saved;
  }
}
