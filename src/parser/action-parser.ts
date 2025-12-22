/**
 * Action and step parsing
 * Handles parsing of action definitions and all step types.
 */
import { TokenType, type Expression, type FieldDefinition, type SchemaDefinition } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type {
  ActionDefinition,
  ActionStep,
  ForStep,
  MapStep,
  ValidateStep,
  StoreStep,
  MatchStep,
  MatchArm,
  FlowDirective,
  LetStep,
  ApplyStep,
  TransformDefinition,
  TransformVariant,
  WebhookStep,
  WebhookStorageConfig,
  StoreDefinition,
  FieldMapping,
  ValidationConstraint,
  StoreOptions,
  RetryConfig,
} from '../ast/nodes.js';
import { FetchParser } from './fetch-parser.js';

export class ActionParser extends FetchParser {
  /**
   * Parse a store definition
   */
  parseStoreDefinition(): StoreDefinition {
    this.consume(ReqonTokenType.STORE, "Expected 'store'");
    const name = this.consumeIdentifier('Expected store name').value;
    this.consume(TokenType.COLON, "Expected ':'");

    let storeType: StoreDefinition['storeType'];
    const typeToken = this.advance();

    switch (typeToken.type) {
      case ReqonTokenType.NOSQL:
        storeType = 'nosql';
        break;
      case ReqonTokenType.SQL:
        storeType = 'sql';
        break;
      case ReqonTokenType.MEMORY:
        storeType = 'memory';
        break;
      default:
        throw this.error(`Unknown store type: ${typeToken.value}`);
    }

    this.consume(TokenType.LPAREN, "Expected '('");
    const target = this.consume(TokenType.STRING, 'Expected target name').value;
    this.consume(TokenType.RPAREN, "Expected ')'");

    return { type: 'StoreDefinition', name, storeType, target };
  }

  /**
   * Parse an action definition
   */
  parseAction(): ActionDefinition {
    this.consume(ReqonTokenType.ACTION, "Expected 'action'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected action name').value;

    this.consume(TokenType.LBRACE, "Expected '{'");
    const steps: ActionStep[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      steps.push(this.parseActionStep());
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'ActionDefinition', name, steps };
  }

  /**
   * Parse a single action step
   */
  protected parseActionStep(): ActionStep {
    if (this.check(ReqonTokenType.CALL)) return this.parseCallStep();
    // Shorthand: get "/path", post "/path", etc.
    if (this.checkHttpMethod()) return this.parseHttpMethodStep();
    if (this.check(ReqonTokenType.FOR)) return this.parseForStep();
    if (this.check(ReqonTokenType.MAP)) return this.parseMapStep();
    if (this.check(ReqonTokenType.APPLY)) return this.parseApplyStep();
    if (this.check(TokenType.VALIDATE)) return this.parseValidateStep();
    if (this.check(ReqonTokenType.STORE)) return this.parseStoreStep();
    if (this.check(TokenType.MATCH)) return this.parseMatchStep();
    if (this.check(TokenType.LET)) return this.parseLetStep();
    if (this.check(ReqonTokenType.WAIT)) return this.parseWaitStep();

    throw this.error(`Expected action step, got: ${this.peek().value}`);
  }

  /**
   * Parse a for loop step
   */
  protected parseForStep(): ForStep {
    this.consume(ReqonTokenType.FOR, "Expected 'for'");
    const variable = this.consumeIdentifier('Expected variable name').value;
    this.consume(TokenType.IN, "Expected 'in'");
    const collection = this.parseExpression();

    let condition: Expression | undefined;
    if (this.match(TokenType.WHERE)) {
      condition = this.parseExpression();
    }

    this.consume(TokenType.LBRACE, "Expected '{'");
    const steps: ActionStep[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      steps.push(this.parseActionStep());
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'ForStep', variable, collection, condition, steps };
  }

  /**
   * Parse a map step
   */
  protected parseMapStep(): MapStep {
    this.consume(ReqonTokenType.MAP, "Expected 'map'");
    const source = this.parseExpression();
    this.consume(TokenType.RIGHT_ARROW, "Expected '->'");
    const targetSchema = this.consume(TokenType.IDENTIFIER, 'Expected target schema').value;

    this.consume(TokenType.LBRACE, "Expected '{'");
    const mappings: FieldMapping[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const field = this.consumeIdentifier('Expected field name').value;
      this.consume(TokenType.COLON, "Expected ':'");
      const expression = this.parseExpression();
      mappings.push({ field, expression });
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'MapStep', source, targetSchema, mappings };
  }

  /**
   * Parse a transform definition
   */
  parseTransform(): TransformDefinition {
    this.consume(ReqonTokenType.TRANSFORM, "Expected 'transform'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected transform name').value;

    const variants: TransformVariant[] = [];

    // Check for simple syntax: transform Name: Source -> Target { ... }
    // or: transform Name -> Target { ... }
    if (this.match(TokenType.COLON)) {
      // Simple syntax with explicit source schema
      const sourceSchema = this.consume(TokenType.IDENTIFIER, 'Expected source schema').value;
      this.consume(TokenType.RIGHT_ARROW, "Expected '->'");
      const targetSchema = this.consume(TokenType.IDENTIFIER, 'Expected target schema').value;
      const mappings = this.parseFieldMappings();
      variants.push({ sourceSchema, targetSchema, mappings });
    } else if (this.match(TokenType.RIGHT_ARROW)) {
      // Simple syntax without explicit source (inferred at runtime)
      const targetSchema = this.consume(TokenType.IDENTIFIER, 'Expected target schema').value;
      const mappings = this.parseFieldMappings();
      variants.push({ sourceSchema: '_', targetSchema, mappings });
    } else {
      // Overloaded syntax: multiple variants
      this.consume(TokenType.LBRACE, "Expected '{' for transform variants");

      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        const variant = this.parseTransformVariant();
        variants.push(variant);
        this.match(TokenType.COMMA);
      }

      this.consume(TokenType.RBRACE, "Expected '}'");
    }

    if (variants.length === 0) {
      throw this.error('Transform must have at least one variant');
    }

    // Validate: all variants must have the same target schema
    const targetSchemas = new Set(variants.map((v) => v.targetSchema));
    if (targetSchemas.size > 1) {
      throw this.error(
        `All transform variants must have the same target schema. Found: ${[...targetSchemas].join(', ')}`
      );
    }

    return { type: 'TransformDefinition', name, variants };
  }

  /**
   * Parse a single transform variant
   */
  protected parseTransformVariant(): TransformVariant {
    this.consume(TokenType.LPAREN, "Expected '(' for variant source schema");

    // Source schema: identifier or '_' for wildcard
    let sourceSchema: string | '_';
    if (this.check(TokenType.IDENTIFIER)) {
      sourceSchema = this.advance().value;
    } else if (this.peek().value === '_') {
      this.advance();
      sourceSchema = '_';
    } else {
      throw this.error('Expected schema name or _ for wildcard');
    }

    this.consume(TokenType.RPAREN, "Expected ')'");

    // Optional guard condition: where condition
    let guard: Expression | undefined;
    if (this.match(TokenType.WHERE)) {
      guard = this.parseExpression();
    }

    this.consume(TokenType.RIGHT_ARROW, "Expected '->'");
    const targetSchema = this.consume(TokenType.IDENTIFIER, 'Expected target schema').value;
    const mappings = this.parseFieldMappings();

    return { sourceSchema, targetSchema, guard, mappings };
  }

  /**
   * Parse field mappings: { field: expression, ... }
   */
  protected parseFieldMappings(): FieldMapping[] {
    this.consume(TokenType.LBRACE, "Expected '{'");
    const mappings: FieldMapping[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const field = this.consumeIdentifier('Expected field name').value;
      this.consume(TokenType.COLON, "Expected ':'");
      const expression = this.parseExpression();
      mappings.push({ field, expression });
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");
    return mappings;
  }

  /**
   * Parse apply step: apply TransformName to expression [as variableName]
   */
  protected parseApplyStep(): ApplyStep {
    this.consume(ReqonTokenType.APPLY, "Expected 'apply'");
    const transform = this.consume(TokenType.IDENTIFIER, 'Expected transform name').value;
    this.consume(ReqonTokenType.TO, "Expected 'to'");
    const source = this.parseExpression();

    // Optional: as variableName
    let as: string | undefined;
    if (this.match(ReqonTokenType.AS)) {
      as = this.consume(TokenType.IDENTIFIER, 'Expected variable name').value;
    }

    return { type: 'ApplyStep', transform, source, as };
  }

  /**
   * Parse validate step
   */
  protected parseValidateStep(): ValidateStep {
    this.consume(TokenType.VALIDATE, "Expected 'validate'");
    const target = this.parseExpression();

    this.consume(TokenType.LBRACE, "Expected '{'");
    const constraints: ValidationConstraint[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      this.consume(TokenType.ASSUME, "Expected 'assume'");
      const condition = this.parseExpression();

      let message: string | undefined;
      let severity: ValidationConstraint['severity'] = 'error';

      constraints.push({ type: 'ValidationConstraint', condition, message, severity });
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'ValidateStep', target, constraints };
  }

  /**
   * Parse store step
   */
  protected parseStoreStep(): StoreStep {
    this.consume(ReqonTokenType.STORE, "Expected 'store'");

    // Check for 'each' keyword
    let isEach = false;
    if (this.match(ReqonTokenType.EACH)) {
      isEach = true;
    }

    const source = this.parseExpression();
    this.consume(TokenType.RIGHT_ARROW, "Expected '->'");
    const target = this.consumeIdentifier('Expected store name').value;

    const options: StoreOptions = {};

    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        const key = this.parseStoreOptionKey();
        this.consume(TokenType.COLON, "Expected ':'");

        switch (key) {
          case 'key':
            options.key = this.parseExpression();
            break;
          case 'partial':
            options.partial = this.match(TokenType.TRUE);
            if (!options.partial) {
              this.consume(TokenType.FALSE, "Expected 'true' or 'false'");
            }
            break;
          case 'upsert':
            options.upsert = this.match(TokenType.TRUE);
            if (!options.upsert) {
              this.consume(TokenType.FALSE, "Expected 'true' or 'false'");
            }
            break;
        }

        this.match(TokenType.COMMA);
      }
      this.consume(TokenType.RBRACE, "Expected '}'");
    }

    return { type: 'StoreStep', source, target, options };
  }

  /**
   * Parse a store option key, handling keyword tokens
   */
  private parseStoreOptionKey(): string {
    if (this.check(ReqonTokenType.KEY)) {
      this.advance();
      return 'key';
    } else if (this.check(ReqonTokenType.PARTIAL)) {
      this.advance();
      return 'partial';
    } else if (this.check(ReqonTokenType.UPSERT)) {
      this.advance();
      return 'upsert';
    }
    return this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
  }

  /**
   * Parse match step (schema overloading)
   */
  protected parseMatchStep(): MatchStep {
    this.consume(TokenType.MATCH, "Expected 'match'");
    const target = this.parseExpression();

    this.consume(TokenType.LBRACE, "Expected '{'");
    const arms: MatchArm[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      arms.push(this.parseMatchArm());
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'MatchStep', target, arms };
  }

  /**
   * Parse a match arm
   */
  protected parseMatchArm(): MatchArm {
    // Schema name or '_' for wildcard
    const schema = this.consume(TokenType.IDENTIFIER, 'Expected schema name or _').value;

    // Optional guard condition: _ where <condition>
    let guard: Expression | undefined;
    if (this.match(TokenType.WHERE)) {
      guard = this.parseExpression();
    }

    this.consume(TokenType.RIGHT_ARROW, "Expected '->'");

    // Check for flow directives
    const flow = this.tryParseFlowDirective();
    if (flow) {
      return { schema, guard, flow };
    }

    // Check for step block
    if (this.check(TokenType.LBRACE)) {
      this.advance();
      const steps: ActionStep[] = [];

      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        steps.push(this.parseActionStep());
        this.match(TokenType.COMMA);
      }

      this.consume(TokenType.RBRACE, "Expected '}'");
      return { schema, guard, steps };
    }

    // Single step
    const step = this.parseActionStep();
    return { schema, guard, steps: [step] };
  }

  /**
   * Try to parse a flow directive
   */
  protected tryParseFlowDirective(): FlowDirective | undefined {
    if (this.match(ReqonTokenType.CONTINUE)) {
      return { type: 'continue' };
    }

    if (this.match(ReqonTokenType.SKIP)) {
      return { type: 'skip' };
    }

    if (this.match(ReqonTokenType.ABORT)) {
      let message: string | undefined;
      if (this.check(TokenType.STRING)) {
        message = this.advance().value;
      }
      return { type: 'abort', message };
    }

    if (this.match(ReqonTokenType.RETRY)) {
      let backoff: RetryConfig | undefined;
      if (this.check(TokenType.LBRACE)) {
        backoff = this.parseRetryConfig();
      }
      return { type: 'retry', backoff };
    }

    if (this.match(ReqonTokenType.QUEUE)) {
      let target: string | undefined;
      if (this.check(TokenType.IDENTIFIER)) {
        target = this.advance().value;
      }
      return { type: 'queue', target };
    }

    if (this.match(ReqonTokenType.JUMP)) {
      const action = this.consume(TokenType.IDENTIFIER, 'Expected action name').value;
      let then: 'retry' | 'continue' | undefined;
      if (this.match(TokenType.THEN)) {
        if (this.match(ReqonTokenType.RETRY)) {
          then = 'retry';
        } else if (this.match(ReqonTokenType.CONTINUE)) {
          then = 'continue';
        } else {
          throw this.error("Expected 'retry' or 'continue' after 'then'");
        }
      }
      return { type: 'jump', action, then };
    }

    return undefined;
  }

  /**
   * Parse let step (variable binding)
   */
  protected parseLetStep(): LetStep {
    this.consume(TokenType.LET, "Expected 'let'");
    const name = this.consumeIdentifier('Expected variable name').value;
    this.consume(TokenType.EQUALS, "Expected '='");
    const value = this.parseExpression();

    return { type: 'LetStep', name, value };
  }

  /**
   * Parse wait step (webhook support)
   */
  protected parseWaitStep(): WebhookStep {
    this.consume(ReqonTokenType.WAIT, "Expected 'wait'");
    this.consume(TokenType.LBRACE, "Expected '{'");

    const step: WebhookStep = { type: 'WebhookStep' };

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.parseWaitOptionKey();
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'timeout':
          step.timeout = parseInt(this.consume(TokenType.NUMBER, 'Expected timeout value').value, 10);
          break;
        case 'path':
          step.path = this.consume(TokenType.STRING, 'Expected path string').value;
          break;
        case 'expectedEvents':
          step.expectedEvents = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'eventFilter':
          step.eventFilter = this.parseExpression();
          break;
        case 'retry':
          step.retryOnTimeout = this.parseRetryConfig();
          break;
        case 'storage':
          step.storage = this.parseWebhookStorageConfig();
          break;
        default:
          throw this.error(`Unknown wait option: ${key}`);
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return step;
  }

  /**
   * Parse a wait option key, handling keyword tokens
   */
  private parseWaitOptionKey(): string {
    if (this.check(ReqonTokenType.TIMEOUT)) {
      this.advance();
      return 'timeout';
    } else if (this.check(ReqonTokenType.PATH)) {
      this.advance();
      return 'path';
    } else if (this.check(ReqonTokenType.EXPECTED_EVENTS)) {
      this.advance();
      return 'expectedEvents';
    } else if (this.check(ReqonTokenType.EVENT_FILTER)) {
      this.advance();
      return 'eventFilter';
    } else if (this.check(ReqonTokenType.RETRY)) {
      this.advance();
      return 'retry';
    } else if (this.check(ReqonTokenType.STORAGE)) {
      this.advance();
      return 'storage';
    }
    return this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
  }

  /**
   * Parse webhook storage config
   */
  protected parseWebhookStorageConfig(): WebhookStorageConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    let target: string | undefined;
    let key: Expression | undefined;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      let optionKey: string;
      if (this.check(ReqonTokenType.KEY)) {
        this.advance();
        optionKey = 'key';
      } else {
        optionKey = this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
      }
      this.consume(TokenType.COLON, "Expected ':'");

      switch (optionKey) {
        case 'target':
          target = this.consume(TokenType.IDENTIFIER, 'Expected store name').value;
          break;
        case 'key':
          key = this.parseExpression();
          break;
        default:
          throw this.error(`Unknown storage option: ${optionKey}`);
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    if (!target) {
      throw this.error('Webhook storage must have a target store');
    }

    return { target, key };
  }

  /**
   * Parse a schema definition
   */
  parseSchema(): SchemaDefinition {
    this.consume(TokenType.SCHEMA, "Expected 'schema'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected schema name').value;

    this.consume(TokenType.LBRACE, "Expected '{'");
    const fields: FieldDefinition[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      fields.push(this.parseFieldDefinition());
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return {
      type: 'SchemaDefinition',
      name,
      fields,
    };
  }

  /**
   * Parse a field definition
   */
  protected parseFieldDefinition(): FieldDefinition {
    const name = this.consumeIdentifier('Expected field name').value;
    this.consume(TokenType.COLON, "Expected ':'");

    // Simplified field type parsing
    const typeName = this.consume(TokenType.IDENTIFIER, 'Expected type').value;

    // Handle optional/nullable type marker (?)
    this.match(TokenType.QUESTION);

    return {
      type: 'FieldDefinition',
      name,
      fieldType: { type: 'PrimitiveType', name: typeName as 'string' | 'int' | 'decimal' | 'date' | 'boolean' },
    };
  }
}
