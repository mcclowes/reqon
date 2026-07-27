import { TokenType, type Expression, type QualifiedName, type MatchArm } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import { ReqonParserBase } from './base.js';

// Extended expression type for Reqon's 'is' type checking
export interface IsExpression {
  type: 'IsExpression';
  operand: Expression;
  typeCheck: string; // 'array', 'object', 'string', 'number', 'boolean', 'null', 'undefined'
}

// Object literal expression: { key: value, ..., ...spread }
export interface ObjectLiteralExpression {
  type: 'ObjectLiteral';
  properties: ObjectProperty[];
}

export interface ObjectProperty {
  key: string;
  value: Expression;
  /** When true this is a `...expr` spread; `value` is the source and `key` is unused. */
  spread?: boolean;
}

// Nullish coalescing: `a ?? b` yields `a` unless it is null/undefined, then `b`.
// Distinct from `or`, which falls back on any falsy value. Short-circuits.
export interface NullishExpression {
  type: 'NullishExpression';
  left: Expression;
  right: Expression;
}

// Subscript access: `obj[key]` / `arr[0]`. Complements dotted QualifiedName paths
// with dynamic, computed, and non-identifier keys.
export interface IndexExpression {
  type: 'IndexExpression';
  object: Expression;
  index: Expression;
}

// Guards unbounded recursive descent from blowing the JS stack on deeply nested
// input, surfacing a structured ParseError instead of a raw V8 RangeError.
const MAX_EXPRESSION_DEPTH = 200;

export class ReqonExpressionParser extends ReqonParserBase {
  private expressionDepth = 0;

  parseExpression(): Expression {
    if (++this.expressionDepth > MAX_EXPRESSION_DEPTH) {
      this.expressionDepth--;
      throw this.error('Expression nesting too deep (maximum depth 200 exceeded)');
    }
    try {
      return this.parseTernary();
    } finally {
      this.expressionDepth--;
    }
  }

  parseLogicalExpression(): Expression {
    return this.parseOr();
  }

  private parseTernary(): Expression {
    const condition = this.parseNullish();

    if (this.match(TokenType.QUESTION)) {
      const consequent = this.parseTernaryBranch();
      this.consume(TokenType.COLON, "Expected ':' in ternary expression");
      const alternate = this.parseTernaryBranch();
      return {
        type: 'TernaryExpression',
        condition,
        consequent,
        alternate,
      };
    }

    return condition;
  }

  // Parse a ternary branch - allows nested ternaries but skips superposition
  private parseTernaryBranch(): Expression {
    const expr = this.parseTernaryBranchOr();

    if (this.match(TokenType.QUESTION)) {
      const consequent = this.parseTernaryBranch();
      this.consume(TokenType.COLON, "Expected ':' in ternary expression");
      const alternate = this.parseTernaryBranch();
      return {
        type: 'TernaryExpression',
        condition: expr,
        consequent,
        alternate,
      };
    }

    return expr;
  }

  private parseTernaryBranchOr(): Expression {
    let left = this.parseTernaryBranchAnd();

    while (this.match(TokenType.OR)) {
      const right = this.parseTernaryBranchAnd();
      left = { type: 'LogicalExpression', operator: 'or', left, right };
    }

    return left;
  }

  private parseTernaryBranchAnd(): Expression {
    let left = this.parseTernaryBranchNot();

    while (this.match(TokenType.AND)) {
      const right = this.parseTernaryBranchNot();
      left = { type: 'LogicalExpression', operator: 'and', left, right };
    }

    return left;
  }

  private parseTernaryBranchNot(): Expression {
    if (this.match(TokenType.NOT)) {
      const operand = this.parseTernaryBranchNot();
      return { type: 'NotExpression', operand };
    }

    // Skip superposition, go directly to comparison
    return this.parseComparison();
  }

  // Nullish coalescing sits just below the ternary, above logical `or`, so
  // `a ?? b` binds tighter than `?:` but the two can't be mixed unparenthesized.
  private parseNullish(): Expression {
    let left = this.parseOr();

    while (this.check(ReqonTokenType.NULLISH)) {
      this.advance();
      const right = this.parseOr();
      left = { type: 'NullishExpression', left, right } as unknown as Expression;
    }

    return left;
  }

  private parseOr(): Expression {
    let left = this.parseAnd();

    while (this.match(TokenType.OR)) {
      const right = this.parseAnd();
      left = { type: 'LogicalExpression', operator: 'or', left, right };
    }

    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();

    while (this.match(TokenType.AND)) {
      const right = this.parseNot();
      left = { type: 'LogicalExpression', operator: 'and', left, right };
    }

    return left;
  }

  private parseNot(): Expression {
    if (this.match(TokenType.NOT)) {
      const operand = this.parseNot();
      return { type: 'NotExpression', operand };
    }

    return this.parseSuperposition();
  }

  private parseSuperposition(): Expression {
    const first = this.parseSuperpositionOption();

    if (this.check(TokenType.PIPE)) {
      const options = [first];

      while (this.match(TokenType.PIPE)) {
        options.push(this.parseSuperpositionOption());
      }

      return { type: 'SuperpositionExpression', options };
    }

    return first.value;
  }

  private parseSuperpositionOption(): { weight?: number; value: Expression } {
    const expr = this.parseComparison();

    if (expr.type === 'Literal' && expr.dataType === 'number' && this.check(TokenType.COLON)) {
      this.advance();
      const value = this.parseComparison();
      return { weight: expr.value as number, value };
    }

    return { value: expr };
  }

  parseComparison(): Expression {
    let left = this.parseRange();

    while (
      this.checkAny(
        TokenType.LT,
        TokenType.GT,
        TokenType.LTE,
        TokenType.GTE,
        TokenType.DOUBLE_EQUALS,
        ReqonTokenType.NOT_EQUALS
      )
    ) {
      const token = this.advance();
      // Normalize the operator value for NOT_EQUALS
      const operator = token.type === ReqonTokenType.NOT_EQUALS ? '!=' : token.value;
      const right = this.parseRange();
      left = { type: 'BinaryExpression', operator, left, right };
    }

    // Check for 'is' type checking: expr is array, expr is string, etc.
    if (this.check(ReqonTokenType.IS)) {
      this.advance(); // consume 'is'
      const typeCheck = this.consumeName("Expected type name after 'is'").value;
      return { type: 'IsExpression', operand: left, typeCheck } as unknown as Expression;
    }

    // Check for 'in' membership: expr in collection. Safe alongside for-loops,
    // which consume their own `in` before parsing the collection expression.
    if (this.check(TokenType.IN)) {
      this.advance(); // consume 'in'
      const right = this.parseRange();
      return { type: 'BinaryExpression', operator: 'in', left, right };
    }

    return left;
  }

  parseRange(): Expression {
    const left = this.parseAdditive();

    if (this.match(TokenType.DOTDOT)) {
      const right = this.check(TokenType.NUMBER) ? this.parseAdditive() : undefined;
      return { type: 'RangeExpression', min: left, max: right };
    }

    return left;
  }

  parseAdditive(): Expression {
    let left = this.parseMultiplicative();

    while (this.checkAny(TokenType.PLUS, TokenType.MINUS)) {
      const operator = this.advance().value;
      const right = this.parseMultiplicative();
      left = { type: 'BinaryExpression', operator, left, right };
    }

    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary();

    while (this.checkAny(TokenType.STAR, TokenType.SLASH)) {
      const operator = this.advance().value;
      const right = this.parseUnary();
      left = { type: 'BinaryExpression', operator, left, right };
    }

    return left;
  }

  private parseUnary(): Expression {
    if (this.match(TokenType.CARET)) {
      const path = this.parseQualifiedName();
      return { type: 'ParentReference', path };
    }

    if (this.checkAny(TokenType.MINUS, TokenType.PLUS)) {
      const operator = this.advance().value;
      const operand = this.parseUnary();
      return { type: 'UnaryExpression', operator, operand };
    }

    return this.parseCall();
  }

  private parseCall(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        const args: Expression[] = [];
        if (!this.check(TokenType.RPAREN)) {
          do {
            args.push(this.parseExpression());
          } while (this.match(TokenType.COMMA));
        }
        this.consume(TokenType.RPAREN, "Expected ')'");

        if (expr.type === 'Identifier') {
          expr = { type: 'CallExpression', callee: expr.name, arguments: args };
        } else if (expr.type === 'QualifiedName') {
          expr = { type: 'CallExpression', callee: expr.parts.join('.'), arguments: args };
        }
      } else if (this.match(TokenType.LBRACKET)) {
        // Subscript access: expr[index]. The index is any expression, so both
        // static (`data["field"]`, `arr[0]`) and dynamic (`cache[id]`) keys work.
        const index = this.parseExpression();
        this.consume(TokenType.RBRACKET, "Expected ']' after index expression");
        expr = { type: 'IndexExpression', object: expr, index } as unknown as Expression;
      } else if (this.match(TokenType.DOT)) {
        const name = this.consumeName('Expected property name').value;
        if (expr.type === 'Identifier') {
          expr = { type: 'QualifiedName', parts: [expr.name, name] };
        } else if (expr.type === 'QualifiedName') {
          expr.parts.push(name);
        } else {
          // Property access after a subscript or other computed expression
          // (e.g. `arr[0].name`) can't extend a QualifiedName, so fall back to
          // an IndexExpression with the field name as a string literal key.
          expr = {
            type: 'IndexExpression',
            object: expr,
            index: { type: 'Literal', value: name, dataType: 'string' },
          } as unknown as Expression;
        }
      } else {
        break;
      }
    }

    return expr;
  }

  parsePrimary(): Expression {
    // Match expression
    if (this.match(TokenType.MATCH)) {
      return this.parseMatchExpression();
    }

    // Ordered sequence
    if (this.match(TokenType.LBRACKET)) {
      return this.parseOrderedSequence();
    }

    // Any of expression
    if (this.match(TokenType.ANY)) {
      this.consume(TokenType.OF, "Expected 'of'");
      const collection = this.parseExpression();
      let condition: Expression | undefined;
      if (this.match(TokenType.WHERE)) {
        condition = this.parseExpression();
      }
      return { type: 'AnyOfExpression', collection, condition };
    }

    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')'");
      return expr;
    }

    // Number literal
    if (this.check(TokenType.NUMBER)) {
      const value = parseFloat(this.advance().value);
      return { type: 'Literal', value, dataType: 'number' };
    }

    // String literal
    if (this.check(TokenType.STRING)) {
      const value = this.advance().value;
      return { type: 'Literal', value, dataType: 'string' };
    }

    // Null literal
    if (this.match(TokenType.NULL)) {
      return { type: 'Literal', value: null, dataType: 'null' };
    }

    // Boolean literals
    if (this.match(TokenType.TRUE)) {
      return { type: 'Literal', value: true, dataType: 'boolean' };
    }
    if (this.match(TokenType.FALSE)) {
      return { type: 'Literal', value: false, dataType: 'boolean' };
    }

    // Object literal: { key: value, ... }
    if (this.match(TokenType.LBRACE)) {
      return this.parseObjectLiteral();
    }

    // Identifier (including HTTP method tokens that can be used as identifiers)
    if (this.checkIdentifier()) {
      const name = this.advance().value;
      return { type: 'Identifier', name };
    }

    // .field shorthand
    if (this.match(TokenType.DOT)) {
      const name = this.consumeName("Expected field name after '.'").value;
      return { type: 'Identifier', name };
    }

    throw this.error(`Unexpected token: ${this.peek().value}`);
  }

  private parseMatchExpression(): Expression {
    // Parse the subject with the full expression parser so member paths
    // (`match report.tier { ... }`), subscripts, and calls work here exactly
    // as they do in the statement form (parseMatchStep). parsePrimary alone
    // stopped at the bare identifier, leaving the trailing `.field` to be
    // mismatched against the expected `{`.
    const value = this.parseExpression();
    this.consume(TokenType.LBRACE, "Expected '{'");

    const arms: MatchArm[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const pattern = this.parseExpression();

      // Optional guard: `pattern where <condition>`. A plain identifier pattern
      // then acts as a binding for the matched value (e.g. `s where s > 800`).
      let guard: Expression | undefined;
      if (this.match(TokenType.WHERE)) {
        guard = this.parseExpression();
      }

      this.consume(TokenType.ARROW, "Expected '=>'");
      const result = this.parseExpression();
      arms.push({ pattern, result, ...(guard ? { guard } : {}) } as MatchArm);
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");
    return { type: 'MatchExpression', value, arms };
  }

  private parseOrderedSequence(): Expression {
    const elements: Expression[] = [];

    if (this.check(TokenType.RBRACKET)) {
      throw this.error('Ordered sequence cannot be empty');
    }

    do {
      elements.push(this.parseExpression());
    } while (this.match(TokenType.COMMA));

    this.consume(TokenType.RBRACKET, "Expected ']'");

    return { type: 'OrderedSequenceType', elements };
  }

  private parseObjectLiteral(): Expression {
    const properties: ObjectProperty[] = [];

    // Handle empty object {}
    if (this.check(TokenType.RBRACE)) {
      this.advance();
      return { type: 'ObjectLiteral', properties } as unknown as Expression;
    }

    do {
      // Spread property: `...expr` merges the source object's own enumerable
      // properties into this literal. Later properties override earlier ones.
      if (this.match(ReqonTokenType.SPREAD)) {
        const value = this.parseExpression();
        properties.push({ key: '', value, spread: true });
        continue;
      }

      // Key can be an identifier, a string, or any reserved keyword's text.
      // The key sits in a name position (always followed by `:`), so words that
      // the lexer reserves as keywords (`action`, `source`, `status`, ...) are
      // valid keys too.
      let key: string;
      if (this.check(TokenType.STRING)) {
        key = this.advance().value;
      } else if (
        !this.check(TokenType.RBRACE) &&
        !this.check(TokenType.COMMA) &&
        !this.check(TokenType.COLON) &&
        !this.isAtEnd()
      ) {
        key = this.advance().value;
      } else {
        throw this.error('Expected property key (identifier or string)');
      }

      this.consume(TokenType.COLON, "Expected ':' after property key");
      const value = this.parseExpression();
      properties.push({ key, value });
    } while (this.match(TokenType.COMMA) && !this.check(TokenType.RBRACE));

    this.consume(TokenType.RBRACE, "Expected '}'");
    return { type: 'ObjectLiteral', properties } as unknown as Expression;
  }

  parseQualifiedName(): QualifiedName {
    const parts: string[] = [];
    parts.push(this.consume(TokenType.IDENTIFIER, 'Expected identifier').value);

    while (this.match(TokenType.DOT)) {
      parts.push(this.consume(TokenType.IDENTIFIER, 'Expected identifier').value);
    }

    return { type: 'QualifiedName', parts };
  }
}
