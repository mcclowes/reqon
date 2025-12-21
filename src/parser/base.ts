import { TokenType, type Token } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import { ParseError, type ErrorContext } from '../errors/index.js';

// Token type can be Vague's TokenType, Reqon's ReqonTokenType, or a plugin string
type AnyTokenType = TokenType | ReqonTokenType | string;

export class ReqonParserBase {
  protected tokens: Token[];
  protected pos = 0;
  protected source?: string;
  protected filePath?: string;

  constructor(tokens: Token[], source?: string, filePath?: string) {
    this.tokens = tokens.filter((t) => t.type !== TokenType.NEWLINE);
    this.source = source;
    this.filePath = filePath;
  }

  protected peek(): Token {
    return this.tokens[this.pos];
  }

  protected peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  protected check(type: AnyTokenType): boolean {
    return !this.isAtEnd() && this.peek().type === type;
  }

  protected checkAny(...types: AnyTokenType[]): boolean {
    return types.some((t) => this.check(t));
  }

  protected match(type: AnyTokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  protected matchAny(...types: AnyTokenType[]): AnyTokenType | null {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return type;
      }
    }
    return null;
  }

  protected advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.tokens[this.pos - 1];
  }

  protected consume(type: AnyTokenType, message: string): Token {
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
