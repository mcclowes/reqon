/**
 * Fetch step parsing
 * Handles parsing of HTTP fetch steps (get, post, put, patch, delete, call).
 */
import { TokenType, type Expression } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type {
  FetchStep,
  PaginationConfig,
  RetryConfig,
  SinceConfig,
  OperationRef,
} from '../ast/nodes.js';
import { ScheduleParser } from './schedule-parser.js';

export class FetchParser extends ScheduleParser {
  /**
   * Check if current token is an HTTP method keyword
   */
  protected checkHttpMethod(): boolean {
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
  protected parseHttpMethodStep(): FetchStep {
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

    // Parse optional config block
    const options = this.parseFetchOptions();

    return {
      type: 'FetchStep',
      method,
      path,
      ...options,
    };
  }

  /**
   * Parse OAS-style call: call Source.operationId { options }
   */
  protected parseCallStep(): FetchStep {
    this.consume(ReqonTokenType.CALL, "Expected 'call'");

    // OAS-style: call Source.operationId
    const sourceName = this.consume(TokenType.IDENTIFIER, 'Expected source name').value;
    this.consume(TokenType.DOT, "Expected '.'");
    const opId = this.consume(TokenType.IDENTIFIER, 'Expected operationId').value;
    const operationRef: OperationRef = { source: sourceName, operationId: opId };

    const options = this.parseFetchOptions();

    return {
      type: 'FetchStep',
      operationRef,
      ...options,
    };
  }

  /**
   * Parse fetch options block (shared between HTTP methods and call)
   */
  protected parseFetchOptions(): Partial<FetchStep> {
    let source: string | undefined;
    let body: Expression | undefined;
    let headers: Record<string, Expression> | undefined;
    let paginate: PaginationConfig | undefined;
    let until: Expression | undefined;
    let retry: RetryConfig | undefined;
    let since: SinceConfig | undefined;
    let backfill: boolean | undefined;
    let allow: number[] | undefined;

    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        const key = this.parseFetchOptionKey();
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
          case 'allow':
            allow = this.parseStatusList();
            break;
          case 'backfill':
            backfill = this.match(TokenType.TRUE);
            if (!backfill) {
              this.consume(TokenType.FALSE, "Expected 'true' or 'false'");
            }
            break;
          default:
            throw this.error(`Unknown fetch option: ${key}`);
        }

        this.match(TokenType.COMMA);
      }
      this.consume(TokenType.RBRACE, "Expected '}'");
    }

    return { source, body, headers, paginate, until, retry, since, backfill, allow };
  }

  /**
   * Parse a fetch option key, handling keyword tokens that can appear as keys
   */
  private parseFetchOptionKey(): string {
    if (this.check(ReqonTokenType.SOURCE)) {
      this.advance();
      return 'source';
    } else if (this.check(ReqonTokenType.PAGINATE)) {
      this.advance();
      return 'paginate';
    } else if (this.check(ReqonTokenType.UNTIL)) {
      this.advance();
      return 'until';
    } else if (this.check(ReqonTokenType.RETRY)) {
      this.advance();
      return 'retry';
    } else if (this.check(ReqonTokenType.SINCE)) {
      this.advance();
      return 'since';
    }
    return this.consume(TokenType.IDENTIFIER, 'Expected option key').value;
  }

  protected parseSinceConfig(): SinceConfig {
    // since: lastSync
    // since: lastSync("custom-key")
    // since: lastSync { param: "modified_since", format: "unix" }
    // since: lastSync { header: "If-Modified-Since" }

    if (this.check(ReqonTokenType.LAST_SYNC)) {
      this.advance();

      let key: string | undefined;
      let param: string | undefined;
      let header: string | undefined;
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
            case 'header':
              header = this.consume(TokenType.STRING, 'Expected header name').value;
              break;
            case 'format':
              format = this.consume(TokenType.IDENTIFIER, 'Expected format')
                .value as SinceConfig['format'];
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
        header,
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

  protected parsePaginationConfig(): PaginationConfig {
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

  /** `allow: [404, 410]` - a bare `allow: 404` is read as a one-entry list. */
  protected parseStatusList(): number[] {
    const readStatus = (): number => {
      const token = this.consume(TokenType.NUMBER, 'Expected an HTTP status code');
      const status = parseInt(token.value, 10);
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw this.error(`Not an HTTP status code: ${token.value}`);
      }
      return status;
    };

    if (!this.match(TokenType.LBRACKET)) return [readStatus()];

    const statuses: number[] = [];
    while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
      statuses.push(readStatus());
      this.match(TokenType.COMMA);
    }
    this.consume(TokenType.RBRACKET, "Expected ']'");
    if (statuses.length === 0) throw this.error('allow needs at least one status code');
    return statuses;
  }

  protected parseRetryConfig(): RetryConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    let maxAttempts = 3;
    let backoff: RetryConfig['backoff'] = 'exponential';
    let initialDelay = 1000;
    let maxDelay: number | undefined;
    let timeout: number | undefined;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected retry option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'maxAttempts':
          maxAttempts = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'backoff':
          backoff = this.consume(TokenType.IDENTIFIER, 'Expected backoff type')
            .value as RetryConfig['backoff'];
          break;
        case 'initialDelay':
          initialDelay = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'maxDelay':
          maxDelay = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'timeout':
          timeout = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { maxAttempts, backoff, initialDelay, maxDelay, timeout };
  }
}
