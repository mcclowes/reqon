/**
 * Source definition parsing
 * Handles parsing of source definitions, auth config, rate limiting, and circuit breaker config.
 */
import { TokenType, type Expression, type Token } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type {
  SourceDefinition,
  SourceConfig,
  AuthConfig,
  RateLimitSourceConfig,
  CircuitBreakerSourceConfig,
} from '../ast/nodes.js';
import { ReqonExpressionParser } from './expressions.js';

export class SourceParser extends ReqonExpressionParser {
  parseSource(): SourceDefinition {
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

  protected parseSourceConfig(hasOAS = false): SourceConfig {
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

  protected parseRateLimitConfig(): RateLimitSourceConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    const config: RateLimitSourceConfig = {};

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected rate limit option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'strategy':
          config.strategy = this.consume(TokenType.IDENTIFIER, 'Expected strategy').value as
            | 'pause'
            | 'throttle'
            | 'fail';
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

  protected parseCircuitBreakerConfig(): CircuitBreakerSourceConfig {
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

  protected parseAuthConfig(): AuthConfig {
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
}
