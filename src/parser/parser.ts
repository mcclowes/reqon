import { TokenType, type Expression, type SchemaDefinition, type FieldDefinition, type Token } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
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
  MatchStep,
  MatchArm,
  FlowDirective,
  LetStep,
  ApplyStep,
  TransformDefinition,
  TransformVariant,
  WebhookStep,
  WebhookStorageConfig,
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
  SinceConfig,
  RateLimitSourceConfig,
  CircuitBreakerSourceConfig,
} from '../ast/nodes.js';

export class ReqonParser extends ReqonExpressionParser {
  constructor(tokens: Token[], source?: string, filePath?: string) {
    super(tokens, source, filePath);
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
    if (this.check(ReqonTokenType.ACTION)) return this.parseAction();
    if (this.check(ReqonTokenType.TRANSFORM)) return this.parseTransform();

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
    const transforms: TransformDefinition[] = [];
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
      } else if (this.check(ReqonTokenType.TRANSFORM)) {
        transforms.push(this.parseTransform());
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

    // Build sets of defined names for validation
    const definedStores = new Set(stores.map((s) => s.name));
    const definedActions = new Set(actions.map((a) => a.name));
    const definedSources = new Set(sources.map((s) => s.name));
    const definedTransforms = new Set(transforms.map((t) => t.name));

    // Validate all references within actions (stores, sources)
    // Note: Pipeline references are validated by the loader after action merging
    this.validateActionReferences(actions, definedStores, definedSources, definedActions, definedTransforms);

    return {
      type: 'MissionDefinition',
      name,
      schedule,
      sources,
      stores,
      schemas,
      transforms,
      actions,
      pipeline,
    };
  }

  /**
   * Validate that all store, source, action, and transform references in actions exist
   */
  private validateActionReferences(
    actions: ActionDefinition[],
    definedStores: Set<string>,
    definedSources: Set<string>,
    definedActions: Set<string>,
    definedTransforms: Set<string>
  ): void {
    for (const action of actions) {
      this.validateStepsReferences(
        action.steps,
        definedStores,
        definedSources,
        definedActions,
        definedTransforms,
        action.name
      );
    }
  }

  /**
   * Recursively validate store, source, action, and transform references in action steps
   */
  private validateStepsReferences(
    steps: ActionStep[],
    definedStores: Set<string>,
    definedSources: Set<string>,
    definedActions: Set<string>,
    definedTransforms: Set<string>,
    actionName: string
  ): void {
    for (const step of steps) {
      if (step.type === 'StoreStep') {
        if (!definedStores.has(step.target)) {
          throw this.error(
            `Store '${step.target}' is not defined. ` +
              `Available stores: ${[...definedStores].join(', ') || 'none'}`
          );
        }
      } else if (step.type === 'FetchStep') {
        // Validate source reference if specified
        if (step.source && !definedSources.has(step.source)) {
          throw this.error(
            `Source '${step.source}' is not defined. ` +
              `Available sources: ${[...definedSources].join(', ') || 'none'}`
          );
        }
        // Validate operationRef source if present
        if (step.operationRef && !definedSources.has(step.operationRef.source)) {
          throw this.error(
            `Source '${step.operationRef.source}' is not defined. ` +
              `Available sources: ${[...definedSources].join(', ') || 'none'}`
          );
        }
      } else if (step.type === 'ApplyStep') {
        // Validate transform reference
        if (!definedTransforms.has(step.transform)) {
          throw this.error(
            `Transform '${step.transform}' is not defined. ` +
              `Available transforms: ${[...definedTransforms].join(', ') || 'none'}`
          );
        }
      } else if (step.type === 'ForStep') {
        // Recursively validate nested steps
        this.validateStepsReferences(
          step.steps,
          definedStores,
          definedSources,
          definedActions,
          definedTransforms,
          actionName
        );
      } else if (step.type === 'MatchStep') {
        // Validate steps in match arms
        for (const arm of step.arms) {
          if (arm.steps) {
            this.validateStepsReferences(
              arm.steps,
              definedStores,
              definedSources,
              definedActions,
              definedTransforms,
              actionName
            );
          }
          // Validate jump target in flow directive
          if (arm.flow?.type === 'jump' && !definedActions.has(arm.flow.action)) {
            throw this.error(
              `Action '${arm.flow.action}' referenced in jump is not defined. ` +
                `Available actions: ${[...definedActions].join(', ') || 'none'}`
            );
          }
        }
      }
    }
  }

  /**
   * Validate that all action references in the pipeline exist
   */
  private validatePipelineReferences(
    pipeline: PipelineDefinition,
    definedActions: Set<string>
  ): void {
    for (const stage of pipeline.stages) {
      if (stage.action) {
        if (!definedActions.has(stage.action)) {
          throw this.error(
            `Action '${stage.action}' is not defined. ` +
              `Available actions: ${[...definedActions].join(', ') || 'none'}`
          );
        }
      }
      if (stage.actions) {
        for (const actionName of stage.actions) {
          if (!definedActions.has(actionName)) {
            throw this.error(
              `Action '${actionName}' is not defined. ` +
                `Available actions: ${[...definedActions].join(', ') || 'none'}`
            );
          }
        }
      }
    }
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
        // Handle keyword tokens that can appear as option keys
        let key: string;
        if (this.check(ReqonTokenType.RETRY)) {
          this.advance();
          key = 'retry';
        } else {
          key = this.consume(TokenType.IDENTIFIER, 'Expected schedule option key').value;
        }
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
    let rateLimit: RateLimitSourceConfig | undefined;
    let circuitBreaker: CircuitBreakerSourceConfig | undefined;
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
      } else if (key === 'rateLimit') {
        rateLimit = this.parseRateLimitConfig();
      } else if (key === 'circuitBreaker') {
        circuitBreaker = this.parseCircuitBreakerConfig();
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
      rateLimit,
      circuitBreaker,
    };
  }

  private parseRateLimitConfig(): RateLimitSourceConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    const config: RateLimitSourceConfig = {};

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected rate limit option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'strategy':
          config.strategy = this.consume(TokenType.IDENTIFIER, 'Expected strategy').value as 'pause' | 'throttle' | 'fail';
          break;
        case 'maxWait':
          config.maxWait = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'fallbackRpm':
          config.fallbackRpm = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        default:
          throw this.error(`Unknown rate limit option: ${key}`);
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return config;
  }

  private parseCircuitBreakerConfig(): CircuitBreakerSourceConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    const config: CircuitBreakerSourceConfig = {};

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected circuit breaker option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'failureThreshold':
          config.failureThreshold = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'resetTimeout':
          config.resetTimeout = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'successThreshold':
          config.successThreshold = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'failureWindow':
          config.failureWindow = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        default:
          throw this.error(`Unknown circuit breaker option: ${key}`);
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return config;
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

  private checkHttpMethod(): boolean {
    const t = this.peek().type;
    return (
      t === ReqonTokenType.GET ||
      t === ReqonTokenType.POST ||
      t === ReqonTokenType.PUT ||
      t === ReqonTokenType.PATCH ||
      t === ReqonTokenType.DELETE
    );
  }

  /**
   * Parse HTTP method syntax: get "/path" { options }
   */
  private parseHttpMethodStep(): FetchStep {
    const methodToken = this.advance();
    let method: FetchStep['method'];

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
      default:
        throw this.error(`Unexpected HTTP method token: ${methodToken.value}`);
    }

    const path = this.parseExpression();

    // Parse optional config block (same as parseFetchStep)
    let source: string | undefined;
    let body: Expression | undefined;
    let headers: Record<string, Expression> | undefined;
    let paginate: PaginationConfig | undefined;
    let until: Expression | undefined;
    let retry: RetryConfig | undefined;
    let since: SinceConfig | undefined;

    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
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
        } else if (this.check(ReqonTokenType.SINCE)) {
          this.advance();
          key = 'since';
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
          case 'since':
            since = this.parseSinceConfig();
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
      source,
      body,
      headers,
      paginate,
      until,
      retry,
      since,
    };
  }

  // ============================================
  // Call step (OAS operationId)
  // ============================================

  /**
   * Parse OAS-style call: call Source.operationId { options }
   * For direct HTTP requests, use: get "/path", post "/path", etc.
   */
  private parseCallStep(): FetchStep {
    this.consume(ReqonTokenType.CALL, "Expected 'call'");

    // OAS-style: call Source.operationId
    const sourceName = this.consume(TokenType.IDENTIFIER, 'Expected source name').value;
    this.consume(TokenType.DOT, "Expected '.'");
    const opId = this.consume(TokenType.IDENTIFIER, 'Expected operationId').value;
    const operationRef: OperationRef = { source: sourceName, operationId: opId };

    let source: string | undefined;
    let body: Expression | undefined;
    let headers: Record<string, Expression> | undefined;
    let paginate: PaginationConfig | undefined;
    let until: Expression | undefined;
    let retry: RetryConfig | undefined;
    let since: SinceConfig | undefined;

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
        } else if (this.check(ReqonTokenType.SINCE)) {
          this.advance();
          key = 'since';
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
          case 'since':
            since = this.parseSinceConfig();
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
      operationRef,
      source,
      body,
      headers,
      paginate,
      until,
      retry,
      since,
    };
  }

  private parseSinceConfig(): SinceConfig {
    // since: lastSync
    // since: lastSync("custom-key")
    // since: lastSync { param: "modified_since", format: "unix" }

    if (this.check(ReqonTokenType.LAST_SYNC)) {
      this.advance();

      let key: string | undefined;
      let param: string | undefined;
      let format: SinceConfig['format'];
      let updateFrom: string | undefined;

      // Check for optional key: lastSync("key")
      if (this.match(TokenType.LPAREN)) {
        key = this.consume(TokenType.STRING, 'Expected checkpoint key').value;
        this.consume(TokenType.RPAREN, "Expected ')'");
      }

      // Check for optional config block
      if (this.match(TokenType.LBRACE)) {
        while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
          const optionKey = this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
          this.consume(TokenType.COLON, "Expected ':'");

          switch (optionKey) {
            case 'param':
              param = this.consume(TokenType.STRING, 'Expected param name').value;
              break;
            case 'format':
              format = this.consume(TokenType.IDENTIFIER, 'Expected format').value as SinceConfig['format'];
              break;
            case 'updateFrom':
              updateFrom = this.consume(TokenType.STRING, 'Expected field path').value;
              break;
            default:
              throw this.error(`Unknown since option: ${optionKey}`);
          }

          this.match(TokenType.COMMA);
        }
        this.consume(TokenType.RBRACE, "Expected '}'");
      }

      return {
        type: 'lastSync',
        key,
        param,
        format,
        updateFrom,
      };
    }

    // since: <expression> - custom expression for the timestamp
    const expression = this.parseExpression();
    return {
      type: 'expression',
      expression,
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

  // ============================================
  // Map step
  // ============================================

  private parseMapStep(): MapStep {
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

  // ============================================
  // Transform definition
  // ============================================

  /**
   * Parse a transform definition with optional overloading.
   *
   * Syntax options:
   * 1. Simple transform (single variant):
   *    transform ToStandard: SourceSchema -> TargetSchema { ... }
   *
   * 2. Simple transform (inferred source):
   *    transform ToStandard -> TargetSchema { ... }
   *
   * 3. Overloaded transform (multiple variants):
   *    transform ToUnified {
   *      (SchemaA) -> Target { ... }
   *      (SchemaB) -> Target { ... }
   *      (_) -> Target { ... }  // default/wildcard
   *    }
   */
  private parseTransform(): TransformDefinition {
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
   * Parse a single transform variant: (SchemaName) -> Target { ... }
   * Or with guard: (SchemaName) where condition -> Target { ... }
   */
  private parseTransformVariant(): TransformVariant {
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
  private parseFieldMappings(): FieldMapping[] {
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

  // ============================================
  // Apply step
  // ============================================

  /**
   * Parse apply step: apply TransformName to expression [as variableName]
   */
  private parseApplyStep(): ApplyStep {
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
    this.consume(TokenType.RIGHT_ARROW, "Expected '->'");
    const target = this.consumeIdentifier('Expected store name').value;

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
  // Match step (schema overloading)
  // ============================================

  private parseMatchStep(): MatchStep {
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

  private parseMatchArm(): MatchArm {
    // Schema name or '_' for wildcard
    const schema = this.consume(TokenType.IDENTIFIER, 'Expected schema name or _').value;
    this.consume(TokenType.RIGHT_ARROW, "Expected '->'");

    // After -> we have either:
    // 1. A flow directive (continue, skip, abort, retry, queue, jump)
    // 2. Steps in braces { ... }
    // 3. A single step (store, fetch, etc.)

    // Check for flow directives
    const flow = this.tryParseFlowDirective();
    if (flow) {
      return { schema, flow };
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
      return { schema, steps };
    }

    // Single step
    const step = this.parseActionStep();
    return { schema, steps: [step] };
  }

  private tryParseFlowDirective(): FlowDirective | undefined {
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

  // ============================================
  // Let step (variable binding)
  // ============================================

  private parseLetStep(): LetStep {
    this.consume(TokenType.LET, "Expected 'let'");
    const name = this.consumeIdentifier('Expected variable name').value;
    this.consume(TokenType.EQUALS, "Expected '='");
    const value = this.parseExpression();

    return { type: 'LetStep', name, value };
  }

  // ============================================
  // Wait step (webhook support)
  // ============================================

  /**
   * Parse wait step: wait { timeout: 60000, path: "/webhooks/callback", ... }
   * Waits for an external webhook callback before continuing execution
   */
  private parseWaitStep(): WebhookStep {
    this.consume(ReqonTokenType.WAIT, "Expected 'wait'");
    this.consume(TokenType.LBRACE, "Expected '{'");

    const step: WebhookStep = { type: 'WebhookStep' };

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Accept keyword tokens as option keys
      let key: string;
      if (this.check(ReqonTokenType.TIMEOUT)) {
        this.advance();
        key = 'timeout';
      } else if (this.check(ReqonTokenType.PATH)) {
        this.advance();
        key = 'path';
      } else if (this.check(ReqonTokenType.EXPECTED_EVENTS)) {
        this.advance();
        key = 'expectedEvents';
      } else if (this.check(ReqonTokenType.EVENT_FILTER)) {
        this.advance();
        key = 'eventFilter';
      } else if (this.check(ReqonTokenType.RETRY)) {
        this.advance();
        key = 'retry';
      } else if (this.check(ReqonTokenType.STORAGE)) {
        this.advance();
        key = 'storage';
      } else {
        key = this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
      }
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
   * Parse webhook storage config: { target: store_name, key: .id }
   */
  private parseWebhookStorageConfig(): WebhookStorageConfig {
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
    let condition: Expression | undefined;

    // Check for parallel stage: [Action1, Action2, ...]
    if (this.match(TokenType.LBRACKET)) {
      const actions: string[] = [];

      // First action
      actions.push(this.consume(TokenType.IDENTIFIER, 'Expected action name').value);

      // Additional actions separated by commas
      while (this.match(TokenType.COMMA)) {
        actions.push(this.consume(TokenType.IDENTIFIER, 'Expected action name').value);
      }

      this.consume(TokenType.RBRACKET, "Expected ']'");

      // Optional 'if' condition
      if (this.match(TokenType.IF)) {
        condition = this.parseExpression();
      }

      return { actions, condition };
    }

    // Single action (sequential)
    const action = this.consume(TokenType.IDENTIFIER, 'Expected action name').value;

    // Optional 'if' condition
    if (this.match(TokenType.IF)) {
      condition = this.parseExpression();
    }

    return { action, condition };
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
    const name = this.consumeIdentifier('Expected field name').value;
    this.consume(TokenType.COLON, "Expected ':'");

    // Simplified field type parsing - just grab the type name for now
    // Type names are standard types (string, int, etc.) not HTTP methods
    const typeName = this.consume(TokenType.IDENTIFIER, 'Expected type').value;

    // Handle optional/nullable type marker (?)
    this.match(TokenType.QUESTION);

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
    const name = this.consumeIdentifier('Expected variable name').value;
    this.consume(TokenType.EQUALS, "Expected '='");
    const value = this.parseExpression();

    return { type: 'LetStatement', name, value };
  }
}
