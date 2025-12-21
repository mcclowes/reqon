import { TokenType, type Expression, type QualifiedName, type MatchArm, type Token } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import { ReqonParserBase } from './base.js';

// Extended expression type for Reqon's 'is' type checking
export interface IsExpression {
  type: 'IsExpression';
  operand: Expression;
  typeCheck: string; // 'array', 'object', 'string', 'number', 'boolean', 'null', 'undefined'
}

export class ReqonExpressionParser extends ReqonParserBase {
  parseExpression(): Expression {
    return this.parseTernary();
  }

  parseLogicalExpression(): Expression {
    return this.parseOr();
  }

  private parseTernary(): Expression {
    const condition = this.parseOr();

    if (this.match(TokenType.QUESTION)) {
      const consequent = this.parseTernary();
      this.consume(TokenType.COLON, "Expected ':' in ternary expression");
      const alternate = this.parseTernary();
      return {
        type: 'TernaryExpression',
        condition,
        consequent,
        alternate,
      };
    }

    return condition;
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

    while (this.checkAny(TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE, TokenType.DOUBLE_EQUALS, ReqonTokenType.NOT_EQUALS)) {
      const token = this.advance();
      // Normalize the operator value for NOT_EQUALS
      const operator = token.type === ReqonTokenType.NOT_EQUALS ? '!=' : token.value;
      const right = this.parseRange();
      left = { type: 'BinaryExpression', operator, left, right };
    }

    // Check for 'is' type checking: expr is array, expr is string, etc.
    if (this.check(ReqonTokenType.IS)) {
      this.advance(); // consume 'is'
      const typeCheck = this.consume(TokenType.IDENTIFIER, "Expected type name after 'is'").value;
      return { type: 'IsExpression', operand: left, typeCheck } as unknown as Expression;
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
      } else if (this.match(TokenType.DOT)) {
        const name = this.consume(TokenType.IDENTIFIER, 'Expected property name').value;
        if (expr.type === 'Identifier') {
          expr = { type: 'QualifiedName', parts: [expr.name, name] };
        } else if (expr.type === 'QualifiedName') {
          expr.parts.push(name);
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

    // Identifier (including HTTP method tokens that can be used as identifiers)
    if (this.checkIdentifier()) {
      const name = this.advance().value;
      return { type: 'Identifier', name };
    }

    // .field shorthand
    if (this.match(TokenType.DOT)) {
      const name = this.consumeIdentifier("Expected field name after '.'").value;
      return { type: 'Identifier', name };
    }

    throw this.error(`Unexpected token: ${this.peek().value}`);
  }

  private parseMatchExpression(): Expression {
    const value = this.parsePrimary();
    this.consume(TokenType.LBRACE, "Expected '{'");

    const arms: MatchArm[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const pattern = this.parseExpression();
      this.consume(TokenType.ARROW, "Expected '=>'");
      const result = this.parseExpression();
      arms.push({ pattern, result });
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

  parseQualifiedName(): QualifiedName {
    const parts: string[] = [];
    parts.push(this.consume(TokenType.IDENTIFIER, 'Expected identifier').value);

    while (this.match(TokenType.DOT)) {
      parts.push(this.consume(TokenType.IDENTIFIER, 'Expected identifier').value);
    }

    return { type: 'QualifiedName', parts };
  }
}
