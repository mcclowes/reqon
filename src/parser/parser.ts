import { TokenType, type Expression, type SchemaDefinition, type FieldDefinition } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type { ReqonToken } from '../lexer/tokens.js';
import { ReqonExpressionParser } from './expressions.js';
import type {
  ReqonProgram,
  Statement,
  MissionDefinition,
  SourceDefinition,
  SourceConfig,
  AuthConfig,
  StoreDefinition,
  ActionDefinition,
  ActionStep,
  FetchStep,
  ForStep,
  MapStep,
  ValidateStep,
  StoreStep,
  PaginationConfig,
  RetryConfig,
  FieldMapping,
  ValidationConstraint,
  StoreOptions,
  PipelineDefinition,
  PipelineStage,
  OperationRef,
  ScheduleDefinition,
  IntervalSchedule,
  ScheduleRetryConfig,
} from '../ast/nodes.js';

export class ReqonParser extends ReqonExpressionParser {
  constructor(tokens: ReqonToken[]) {
    super(tokens);
  }

  parse(): ReqonProgram {
    const statements: Statement[] = [];

    while (!this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }

    return { type: 'ReqonProgram', statements };
  }

  private parseStatement(): Statement | null {
    // Reqon-specific statements
    if (this.check(ReqonTokenType.MISSION)) return this.parseMission();
    if (this.check(ReqonTokenType.SOURCE)) return this.parseSource();
    if (this.check(ReqonTokenType.STORE)) return this.parseStoreDefinition();

    // Vague statements (schema, import, let, etc.)
    if (this.check(TokenType.SCHEMA)) return this.parseSchema();
    if (this.check(TokenType.IMPORT)) return this.parseImport();
    if (this.check(TokenType.LET)) return this.parseLet();

    throw this.error(`Unexpected token: ${this.peek().value}`);
  }

  // ============================================
  // Mission definition
  // ============================================

  private parseMission(): MissionDefinition {
    this.consume(ReqonTokenType.MISSION, "Expected 'mission'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected mission name').value;

    this.consume(TokenType.LBRACE, "Expected '{'");

    const sources: SourceDefinition[] = [];
    const stores: StoreDefinition[] = [];
    const schemas: SchemaDefinition[] = [];
    const actions: ActionDefinition[] = [];
    let pipeline: PipelineDefinition | undefined;
    let schedule: ScheduleDefinition | undefined;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      if (this.check(ReqonTokenType.SOURCE)) {
        sources.push(this.parseSource());
      } else if (this.check(ReqonTokenType.STORE)) {
        stores.push(this.parseStoreDefinition());
      } else if (this.check(TokenType.SCHEMA)) {
        schemas.push(this.parseSchema());
      } else if (this.check(ReqonTokenType.ACTION)) {
        actions.push(this.parseAction());
      } else if (this.check(ReqonTokenType.RUN)) {
        pipeline = this.parsePipeline();
      } else if (this.check(ReqonTokenType.SCHEDULE)) {
        schedule = this.parseSchedule();
      } else {
        throw this.error(`Unexpected token in mission: ${this.peek().value}`);
      }
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    if (!pipeline) {
      throw this.error('Mission must have a run pipeline');
    }

    return {
      type: 'MissionDefinition',
      name,
      schedule,
      sources,
      stores,
      schemas,
      actions,
      pipeline,
    };
  }

  // ============================================
  // Schedule definition
  // ============================================

  private parseSchedule(): ScheduleDefinition {
    this.consume(ReqonTokenType.SCHEDULE, "Expected 'schedule'");
    this.consume(TokenType.COLON, "Expected ':'");

    let scheduleType: ScheduleDefinition['scheduleType'];
    let interval: IntervalSchedule | undefined;
    let cronExpression: string | undefined;
    let runAt: string | undefined;
    let timezone: string | undefined;
    let maxConcurrency: number | undefined;
    let skipIfRunning: boolean | undefined;
    let retryOnFailure: ScheduleRetryConfig | undefined;

    // Determine schedule type
    if (this.check(ReqonTokenType.EVERY)) {
      // Interval-based: schedule: every 6 hours
      scheduleType = 'interval';
      interval = this.parseIntervalSchedule();
    } else if (this.check(ReqonTokenType.CRON)) {
      // Cron-based: schedule: cron "0 */6 * * *"
      scheduleType = 'cron';
      this.advance(); // consume 'cron'
      cronExpression = this.consume(TokenType.STRING, 'Expected cron expression string').value;
    } else if (this.check(ReqonTokenType.AT)) {
      // One-time: schedule: at "2025-01-20 09:00 UTC"
      scheduleType = 'once';
      this.advance(); // consume 'at'
      runAt = this.consume(TokenType.STRING, 'Expected datetime string').value;
    } else {
      throw this.error(`Expected 'every', 'cron', or 'at' for schedule type`);
    }

    // Optional configuration block
    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        const key = this.consume(TokenType.IDENTIFIER, 'Expected schedule option key').value;
        this.consume(TokenType.COLON, "Expected ':'");

        switch (key) {
          case 'timezone':
            timezone = this.consume(TokenType.STRING, 'Expected timezone string').value;
            break;
          case 'maxConcurrency':
            maxConcurrency = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
            break;
          case 'skipIfRunning':
            skipIfRunning = this.match(TokenType.TRUE);
            if (!skipIfRunning) {
              this.consume(TokenType.FALSE, "Expected 'true' or 'false'");
            }
            break;
          case 'retry':
            retryOnFailure = this.parseScheduleRetryConfig();
            break;
          default:
            throw this.error(`Unknown schedule option: ${key}`);
        }

        this.match(TokenType.COMMA);
      }
      this.consume(TokenType.RBRACE, "Expected '}'");
    }

    return {
      type: 'ScheduleDefinition',
      scheduleType,
      interval,
      cronExpression,
      runAt,
      timezone,
      maxConcurrency,
      skipIfRunning,
      retryOnFailure,
    };
  }

  private parseIntervalSchedule(): IntervalSchedule {
    this.consume(ReqonTokenType.EVERY, "Expected 'every'");
    const value = parseInt(this.consume(TokenType.NUMBER, 'Expected interval value').value, 10);

    let unit: IntervalSchedule['unit'];
    const unitToken = this.advance();

    switch (unitToken.type) {
      case ReqonTokenType.SECONDS:
        unit = 'seconds';
        break;
      case ReqonTokenType.MINUTES:
        unit = 'minutes';
        break;
      case ReqonTokenType.HOURS:
        unit = 'hours';
        break;
      case ReqonTokenType.DAYS:
        unit = 'days';
        break;
      case ReqonTokenType.WEEKS:
        unit = 'weeks';
        break;
      default:
        throw this.error(`Expected time unit (seconds, minutes, hours, days, weeks), got: ${unitToken.value}`);
    }

    return { value, unit };
  }

  private parseScheduleRetryConfig(): ScheduleRetryConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    let maxRetries = 3;
    let delaySeconds = 60;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected retry option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'maxRetries':
          maxRetries = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'delaySeconds':
          delaySeconds = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        default:
          throw this.error(`Unknown retry option: ${key}`);
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { maxRetries, delaySeconds };
  }

  // ============================================
  // Source definition
  // ============================================

  private parseSource(): SourceDefinition {
    this.consume(ReqonTokenType.SOURCE, "Expected 'source'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected source name').value;

    // Check for 'from' clause (OAS spec path)
    let specPath: string | undefined;
    if (this.match(ReqonTokenType.FROM)) {
      specPath = this.consume(TokenType.STRING, 'Expected OAS spec path').value;
    }

    this.consume(TokenType.LBRACE, "Expected '{'");
    const config = this.parseSourceConfig(specPath !== undefined);
    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'SourceDefinition', name, specPath, config };
  }

  private parseSourceConfig(hasOAS = false): SourceConfig {
    let auth: AuthConfig | undefined;
    let base: string | undefined;
    let validateResponses: boolean | undefined;
    const headers: Record<string, Expression> = {};

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected config key').value;
      this.consume(TokenType.COLON, "Expected ':'");

      if (key === 'auth') {
        auth = this.parseAuthConfig();
      } else if (key === 'base') {
        base = this.consume(TokenType.STRING, 'Expected base URL string').value;
      } else if (key === 'validateResponses') {
        validateResponses = this.match(TokenType.TRUE);
        if (!validateResponses) {
          this.consume(TokenType.FALSE, "Expected 'true' or 'false'");
        }
      } else if (key === 'headers') {
        this.consume(TokenType.LBRACE, "Expected '{'");
        while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
          const headerName = this.consume(TokenType.STRING, 'Expected header name').value;
          this.consume(TokenType.COLON, "Expected ':'");
          headers[headerName] = this.parseExpression();
          this.match(TokenType.COMMA);
        }
        this.consume(TokenType.RBRACE, "Expected '}'");
      }

      this.match(TokenType.COMMA);
    }

    if (!auth) throw this.error('Source must have auth config');
    // Base URL is only required if not using OAS
    if (!base && !hasOAS) throw this.error('Source must have base URL (or use OAS spec)');

    return {
      auth,
      base,
      validateResponses,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
  }

  private parseAuthConfig(): AuthConfig {
    const typeToken = this.advance();
    let type: AuthConfig['type'];

    switch (typeToken.type) {
      case ReqonTokenType.OAUTH2:
        type = 'oauth2';
        break;
      case ReqonTokenType.BEARER:
        type = 'bearer';
        break;
      case ReqonTokenType.BASIC:
        type = 'basic';
        break;
      case ReqonTokenType.API_KEY:
        type = 'api_key';
        break;
      case ReqonTokenType.NONE:
        type = 'none';
        break;
      default:
        throw this.error(`Unknown auth type: ${typeToken.value}`);
    }

    return { type };
  }

  // ============================================
  // Store definition
  // ============================================

  private parseStoreDefinition(): StoreDefinition {
    this.consume(ReqonTokenType.STORE, "Expected 'store'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected store name').value;
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

  // ============================================
  // Action definition
  // ============================================

  private parseAction(): ActionDefinition {
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

  private parseActionStep(): ActionStep {
    if (this.check(ReqonTokenType.FETCH)) return this.parseFetchStep();
    if (this.check(ReqonTokenType.FOR)) return this.parseForStep();
    if (this.check(ReqonTokenType.MAP)) return this.parseMapStep();
    if (this.check(TokenType.VALIDATE)) return this.parseValidateStep();
    if (this.check(ReqonTokenType.STORE)) return this.parseStoreStep();

    throw this.error(`Expected action step, got: ${this.peek().value}`);
  }

  // ============================================
  // Fetch step
  // ============================================

  private parseFetchStep(): FetchStep {
    this.consume(ReqonTokenType.FETCH, "Expected 'fetch'");

    let method: FetchStep['method'];
    let path: Expression | undefined;
    let operationRef: OperationRef | undefined;

    // Check if next token is an HTTP method or an identifier (for Source.operationId)
    const nextToken = this.peek();

    if (
      nextToken.type === ReqonTokenType.GET ||
      nextToken.type === ReqonTokenType.POST ||
      nextToken.type === ReqonTokenType.PUT ||
      nextToken.type === ReqonTokenType.PATCH ||
      nextToken.type === ReqonTokenType.DELETE
    ) {
      // Traditional: fetch GET "/path"
      const methodToken = this.advance();
      switch (methodToken.type) {
        case ReqonTokenType.GET:
          method = 'GET';
          break;
        case ReqonTokenType.POST:
          method = 'POST';
          break;
        case ReqonTokenType.PUT:
          method = 'PUT';
          break;
        case ReqonTokenType.PATCH:
          method = 'PATCH';
          break;
        case ReqonTokenType.DELETE:
          method = 'DELETE';
          break;
      }
      path = this.parseExpression();
    } else if (nextToken.type === TokenType.IDENTIFIER) {
      // OAS-style: fetch Source.operationId
      const sourceName = this.consume(TokenType.IDENTIFIER, 'Expected source name').value;
      this.consume(TokenType.DOT, "Expected '.'");
      const opId = this.consume(TokenType.IDENTIFIER, 'Expected operationId').value;
      operationRef = { source: sourceName, operationId: opId };
    } else {
      throw this.error(`Expected HTTP method or Source.operationId, got: ${nextToken.value}`);
    }

    let source: string | undefined;
    let body: Expression | undefined;
    let headers: Record<string, Expression> | undefined;
    let paginate: PaginationConfig | undefined;
    let until: Expression | undefined;
    let retry: RetryConfig | undefined;

    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        // Accept keyword tokens as option keys
        let key: string;
        if (this.check(ReqonTokenType.SOURCE)) {
          this.advance();
          key = 'source';
        } else if (this.check(ReqonTokenType.PAGINATE)) {
          this.advance();
          key = 'paginate';
        } else if (this.check(ReqonTokenType.UNTIL)) {
          this.advance();
          key = 'until';
        } else if (this.check(ReqonTokenType.RETRY)) {
          this.advance();
          key = 'retry';
        } else {
          key = this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
        }
        this.consume(TokenType.COLON, "Expected ':'");

        switch (key) {
          case 'source':
            source = this.consume(TokenType.IDENTIFIER, 'Expected source name').value;
            break;
          case 'body':
            body = this.parseExpression();
            break;
          case 'paginate':
            paginate = this.parsePaginationConfig();
            break;
          case 'until':
            until = this.parseExpression();
            break;
          case 'retry':
            retry = this.parseRetryConfig();
            break;
          default:
            throw this.error(`Unknown fetch option: ${key}`);
        }

        this.match(TokenType.COMMA);
      }
      this.consume(TokenType.RBRACE, "Expected '}'");
    }

    return {
      type: 'FetchStep',
      method,
      path,
      operationRef,
      source,
      body,
      headers,
      paginate,
      until,
      retry,
    };
  }

  private parsePaginationConfig(): PaginationConfig {
    const typeToken = this.advance();
    let type: PaginationConfig['type'];

    switch (typeToken.type) {
      case ReqonTokenType.OFFSET:
        type = 'offset';
        break;
      case ReqonTokenType.CURSOR:
        type = 'cursor';
        break;
      case ReqonTokenType.PAGE:
        type = 'page';
        break;
      default:
        throw this.error(`Unknown pagination type: ${typeToken.value}`);
    }

    this.consume(TokenType.LPAREN, "Expected '('");
    // Accept keyword tokens as param names (e.g., 'page', 'offset', 'cursor')
    let param: string;
    if (this.check(ReqonTokenType.PAGE)) {
      param = this.advance().value;
    } else if (this.check(ReqonTokenType.OFFSET)) {
      param = this.advance().value;
    } else if (this.check(ReqonTokenType.CURSOR)) {
      param = this.advance().value;
    } else {
      param = this.consume(TokenType.IDENTIFIER, 'Expected param name').value;
    }
    this.consume(TokenType.COMMA, "Expected ','");
    const pageSize = parseInt(this.consume(TokenType.NUMBER, 'Expected page size').value, 10);

    let cursorPath: string | undefined;
    if (type === 'cursor' && this.match(TokenType.COMMA)) {
      cursorPath = this.consume(TokenType.STRING, 'Expected cursor path').value;
    }

    this.consume(TokenType.RPAREN, "Expected ')'");

    return { type, param, pageSize, cursorPath };
  }

  private parseRetryConfig(): RetryConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    let maxAttempts = 3;
    let backoff: RetryConfig['backoff'] = 'exponential';
    let initialDelay = 1000;
    let maxDelay: number | undefined;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected retry option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'maxAttempts':
          maxAttempts = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'backoff':
          backoff = this.consume(TokenType.IDENTIFIER, 'Expected backoff type').value as RetryConfig['backoff'];
          break;
        case 'initialDelay':
          initialDelay = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'maxDelay':
          maxDelay = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { maxAttempts, backoff, initialDelay, maxDelay };
  }

  // ============================================
  // For step
  // ============================================

  private parseForStep(): ForStep {
    this.consume(ReqonTokenType.FOR, "Expected 'for'");
    const variable = this.consume(TokenType.IDENTIFIER, 'Expected variable name').value;
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

  // ============================================
  // Map step
  // ============================================

  private parseMapStep(): MapStep {
    this.consume(ReqonTokenType.MAP, "Expected 'map'");
    const source = this.parseExpression();
    this.consume(ReqonTokenType.RIGHT_ARROW, "Expected '->'");
    const targetSchema = this.consume(TokenType.IDENTIFIER, 'Expected target schema').value;

    this.consume(TokenType.LBRACE, "Expected '{'");
    const mappings: FieldMapping[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const field = this.consume(TokenType.IDENTIFIER, 'Expected field name').value;
      this.consume(TokenType.COLON, "Expected ':'");
      const expression = this.parseExpression();
      mappings.push({ field, expression });
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'MapStep', source, targetSchema, mappings };
  }

  // ============================================
  // Validate step
  // ============================================

  private parseValidateStep(): ValidateStep {
    this.consume(TokenType.VALIDATE, "Expected 'validate'");
    const target = this.parseExpression();

    this.consume(TokenType.LBRACE, "Expected '{'");
    const constraints: ValidationConstraint[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      this.consume(TokenType.ASSUME, "Expected 'assume'");
      const condition = this.parseExpression();

      let message: string | undefined;
      let severity: ValidationConstraint['severity'] = 'error';

      // Optional message and severity could be added here

      constraints.push({ type: 'ValidationConstraint', condition, message, severity });
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { type: 'ValidateStep', target, constraints };
  }

  // ============================================
  // Store step
  // ============================================

  private parseStoreStep(): StoreStep {
    this.consume(ReqonTokenType.STORE, "Expected 'store'");

    // Check for 'each' keyword
    let isEach = false;
    if (this.match(ReqonTokenType.EACH)) {
      isEach = true;
    }

    const source = this.parseExpression();
    this.consume(ReqonTokenType.RIGHT_ARROW, "Expected '->'");
    const target = this.consume(TokenType.IDENTIFIER, 'Expected store name').value;

    const options: StoreOptions = {};

    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        // Accept keyword tokens as option keys
        let key: string;
        if (this.check(ReqonTokenType.KEY)) {
          this.advance();
          key = 'key';
        } else if (this.check(ReqonTokenType.PARTIAL)) {
          this.advance();
          key = 'partial';
        } else if (this.check(ReqonTokenType.UPSERT)) {
          this.advance();
          key = 'upsert';
        } else {
          key = this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
        }
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

  // ============================================
  // Pipeline definition
  // ============================================

  private parsePipeline(): PipelineDefinition {
    this.consume(ReqonTokenType.RUN, "Expected 'run'");

    const stages: PipelineStage[] = [];

    // First stage
    stages.push(this.parsePipelineStage());

    // Subsequent stages with 'then'
    while (this.match(TokenType.THEN)) {
      stages.push(this.parsePipelineStage());
    }

    return { type: 'PipelineDefinition', stages };
  }

  private parsePipelineStage(): PipelineStage {
    const action = this.consume(TokenType.IDENTIFIER, 'Expected action name').value;

    let condition: Expression | undefined;
    let parallel = false;

    // Could add 'if' condition or 'parallel' modifier here

    return { action, condition, parallel };
  }

  // ============================================
  // Vague statement parsing (simplified)
  // ============================================

  private parseSchema(): SchemaDefinition {
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

  private parseFieldDefinition(): FieldDefinition {
    const name = this.consume(TokenType.IDENTIFIER, 'Expected field name').value;
    this.consume(TokenType.COLON, "Expected ':'");

    // Simplified field type parsing - just grab the type name for now
    const typeName = this.consume(TokenType.IDENTIFIER, 'Expected type').value;

    return {
      type: 'FieldDefinition',
      name,
      fieldType: { type: 'PrimitiveType', name: typeName as 'string' | 'int' | 'decimal' | 'date' | 'boolean' },
    };
  }

  private parseImport(): Statement {
    this.consume(TokenType.IMPORT, "Expected 'import'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected import name').value;
    this.consume(TokenType.FROM, "Expected 'from'");
    const path = this.consume(TokenType.STRING, 'Expected import path').value;

    return { type: 'ImportStatement', name, path };
  }

  private parseLet(): Statement {
    this.consume(TokenType.LET, "Expected 'let'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected variable name').value;
    this.consume(TokenType.EQUALS, "Expected '='");
    const value = this.parseExpression();

    return { type: 'LetStatement', name, value };
  }
}
