import { Lexer as VagueLexer, Token, TokenType } from 'vague-lang';
import { REQON_KEYWORDS, ReqonTokenType, type ReqonToken } from './tokens.js';

export class ReqonLexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): ReqonToken[] {
    const tokens: ReqonToken[] = [];

    while (!this.isAtEnd()) {
      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    tokens.push(this.makeToken(TokenType.EOF, ''));
    return tokens;
  }

  private nextToken(): ReqonToken | null {
    this.skipWhitespace();

    if (this.isAtEnd()) return null;

    const char = this.peek();

    // Skip comments
    if (char === '/' && this.peekNext() === '/') {
      this.skipLineComment();
      return null;
    }

    // Newlines (significant for statement termination)
    if (char === '\n') {
      const token = this.makeToken(TokenType.NEWLINE, '\n');
      this.advance();
      this.line++;
      this.column = 1;
      return token;
    }

    // String literals
    if (char === '"') return this.readString();

    // Numbers
    if (this.isDigit(char)) return this.readNumber();

    // Identifiers and keywords
    if (this.isAlpha(char)) return this.readIdentifier();

    // Operators and delimiters
    return this.readOperator();
  }

  private readString(): ReqonToken {
    const startColumn = this.column;
    this.advance(); // consume opening quote

    let value = '';
    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance();
        const escaped = this.advance();
        switch (escaped) {
          case 'n':
            value += '\n';
            break;
          case 't':
            value += '\t';
            break;
          case '\\':
            value += '\\';
            break;
          case '"':
            value += '"';
            break;
          default:
            value += escaped;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      throw new Error(`Unterminated string at line ${this.line}`);
    }

    this.advance(); // consume closing quote
    return {
      type: TokenType.STRING,
      value,
      line: this.line,
      column: startColumn,
    };
  }

  private readNumber(): ReqonToken {
    const startColumn = this.column;
    let value = '';

    while (this.isDigit(this.peek())) {
      value += this.advance();
    }

    // Handle decimals
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      value += this.advance(); // consume '.'
      while (this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    // Handle underscores in numbers (e.g., 100_000)
    value = value.replace(/_/g, '');

    return {
      type: TokenType.NUMBER,
      value,
      line: this.line,
      column: startColumn,
    };
  }

  private readIdentifier(): ReqonToken {
    const startColumn = this.column;
    let value = '';

    while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
      value += this.advance();
    }

    // Check Reqon keywords first, then fall back to Vague keywords
    const reqonType = REQON_KEYWORDS[value];
    if (reqonType) {
      return { type: reqonType, value, line: this.line, column: startColumn };
    }

    // Use Vague's lexer to check for Vague keywords
    const vagueKeywords: Record<string, TokenType> = {
      let: TokenType.LET,
      schema: TokenType.SCHEMA,
      from: TokenType.FROM,
      import: TokenType.IMPORT,
      context: TokenType.CONTEXT,
      distribution: TokenType.DISTRIBUTION,
      dataset: TokenType.DATASET,
      with: TokenType.WITH,
      where: TokenType.WHERE,
      when: TokenType.WHEN,
      in: TokenType.IN,
      per: TokenType.PER,
      any: TokenType.ANY,
      of: TokenType.OF,
      match: TokenType.MATCH,
      affects: TokenType.AFFECTS,
      constraints: TokenType.CONSTRAINTS,
      validate: TokenType.VALIDATE,
      assume: TokenType.ASSUME,
      then: TokenType.THEN,
      refine: TokenType.REFINE,
      if: TokenType.IF,
      violating: TokenType.VIOLATING,
      unique: TokenType.UNIQUE,
      private: TokenType.PRIVATE,
      and: TokenType.AND,
      or: TokenType.OR,
      not: TokenType.NOT,
      null: TokenType.NULL,
      true: TokenType.TRUE,
      false: TokenType.FALSE,
      int: TokenType.INT,
      decimal: TokenType.DECIMAL,
      date: TokenType.DATE,
    };

    const type = vagueKeywords[value] ?? TokenType.IDENTIFIER;
    return { type, value, line: this.line, column: startColumn };
  }

  private readOperator(): ReqonToken {
    const startColumn = this.column;
    const char = this.advance();

    // Check for -> (Reqon-specific)
    if (char === '-' && this.peek() === '>') {
      this.advance();
      return {
        type: ReqonTokenType.RIGHT_ARROW,
        value: '->',
        line: this.line,
        column: startColumn,
      };
    }

    const twoChar = char + this.peek();
    const twoCharOps: Record<string, TokenType> = {
      '..': TokenType.DOTDOT,
      '=>': TokenType.ARROW,
      '==': TokenType.DOUBLE_EQUALS,
      '+=': TokenType.PLUS_EQUALS,
      '<=': TokenType.LTE,
      '>=': TokenType.GTE,
    };

    if (twoCharOps[twoChar]) {
      this.advance();
      return { type: twoCharOps[twoChar], value: twoChar, line: this.line, column: startColumn };
    }

    const singleCharOps: Record<string, TokenType> = {
      '|': TokenType.PIPE,
      '~': TokenType.TILDE,
      ':': TokenType.COLON,
      '=': TokenType.EQUALS,
      '+': TokenType.PLUS,
      '-': TokenType.MINUS,
      '*': TokenType.STAR,
      '/': TokenType.SLASH,
      '.': TokenType.DOT,
      '^': TokenType.CARET,
      '%': TokenType.PERCENT,
      '<': TokenType.LT,
      '>': TokenType.GT,
      '?': TokenType.QUESTION,
      ',': TokenType.COMMA,
      '(': TokenType.LPAREN,
      ')': TokenType.RPAREN,
      '{': TokenType.LBRACE,
      '}': TokenType.RBRACE,
      '[': TokenType.LBRACKET,
      ']': TokenType.RBRACKET,
    };

    const type = singleCharOps[char];
    if (type) {
      return { type, value: char, line: this.line, column: startColumn };
    }

    throw new Error(`Unexpected character '${char}' at line ${this.line}, column ${startColumn}`);
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.advance();
    }
  }

  private makeToken(type: TokenType, value: string): ReqonToken {
    return { type, value, line: this.line, column: this.column };
  }

  private peek(): string {
    return this.source[this.pos] ?? '\0';
  }

  private peekNext(): string {
    return this.source[this.pos + 1] ?? '\0';
  }

  private advance(): string {
    const char = this.source[this.pos];
    this.pos++;
    this.column++;
    return char;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }
}
