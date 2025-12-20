import type { RetryConfig } from '../ast/nodes.js';
import type { RateLimiter, RateLimitInfo } from '../auth/types.js';
import { parseRateLimitHeaders } from '../auth/rate-limiter.js';
import { CircuitBreaker, CircuitBreakerError } from '../auth/circuit-breaker.js';
import { sleep } from '../utils/async.js';

export interface HttpClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: AuthProvider;
  rateLimiter?: RateLimiter;
  circuitBreaker?: CircuitBreaker;
  /** Source name for rate limit and circuit breaker tracking */
  sourceName?: string;
}

export interface AuthProvider {
  getToken(): Promise<string>;
  refreshToken?(): Promise<string>;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  async request<T = unknown>(
    req: HttpRequest,
    retry?: RetryConfig
  ): Promise<HttpResponse<T>> {
    const url = this.buildUrl(req.path, req.query);
    const headers = await this.buildHeaders(req.headers);

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
    };

    const maxAttempts = retry?.maxAttempts ?? 3;
    const backoff = retry?.backoff ?? 'exponential';
    const initialDelay = retry?.initialDelay ?? 1000;
    const maxDelay = retry?.maxDelay ?? 30000;

    let lastError: Error | null = null;

    // Check circuit breaker before attempting requests
    if (this.config.circuitBreaker && this.config.sourceName) {
      // This will throw CircuitBreakerError if circuit is open
      this.config.circuitBreaker.ensureCanProceed(this.config.sourceName, req.path);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Re-check circuit breaker on retries (state may have changed)
        if (attempt > 1 && this.config.circuitBreaker && this.config.sourceName) {
          if (!this.config.circuitBreaker.canProceed(this.config.sourceName, req.path)) {
            // Circuit opened during retries, fail fast
            throw new CircuitBreakerError(
              this.config.sourceName,
              req.path,
              this.config.circuitBreaker.getStatus(this.config.sourceName, req.path).nextAttemptTime?.getTime() ?? 0 - Date.now()
            );
          }
        }

        // Wait for rate limit capacity if we have a rate limiter
        if (this.config.rateLimiter && this.config.sourceName) {
          await this.config.rateLimiter.waitForCapacity(this.config.sourceName, req.path);
        }

        const response = await fetch(url, fetchOptions);

        // Extract and record rate limit info from response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        if (this.config.rateLimiter && this.config.sourceName) {
          const rateLimitInfo = parseRateLimitHeaders(responseHeaders);

          // Add retry-after from 429 responses
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              rateLimitInfo.retryAfter = parseInt(retryAfter, 10);
            }
          }

          this.config.rateLimiter.recordResponse(
            this.config.sourceName,
            rateLimitInfo,
            req.path
          );
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          await sleep(delay);
          continue;
        }

        // Handle server errors with retry
        if (response.status >= 500) {
          // Record failure in circuit breaker
          if (this.config.circuitBreaker && this.config.sourceName) {
            this.config.circuitBreaker.recordFailure(this.config.sourceName, req.path, response.status);
          }

          if (attempt < maxAttempts) {
            const delay = this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
            await sleep(delay);
            continue;
          }
        }

        // Handle 401 - try token refresh
        if (response.status === 401 && this.config.auth?.refreshToken && attempt < maxAttempts) {
          await this.config.auth.refreshToken();
          // Rebuild headers with new token
          const newHeaders = await this.buildHeaders(req.headers);
          fetchOptions.headers = newHeaders;
          continue;
        }

        const data = await response.json() as T;

        // Record success in circuit breaker
        if (this.config.circuitBreaker && this.config.sourceName && response.status < 500) {
          this.config.circuitBreaker.recordSuccess(this.config.sourceName, req.path);
        }

        return {
          status: response.status,
          data,
          headers: responseHeaders,
        };
      } catch (error) {
        lastError = error as Error;

        // Re-throw circuit breaker errors immediately
        if (error instanceof CircuitBreakerError) {
          throw error;
        }

        // Record network errors in circuit breaker
        if (this.config.circuitBreaker && this.config.sourceName) {
          this.config.circuitBreaker.recordFailure(this.config.sourceName, req.path, undefined, true);
        }

        if (attempt < maxAttempts) {
          const delay = this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Request failed after all retries');
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${base}${cleanPath}`;

    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    return url;
  }

  private async buildHeaders(requestHeaders?: Record<string, string>): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.config.headers,
      ...requestHeaders,
    };

    if (this.config.auth) {
      const token = await this.config.auth.getToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private calculateDelay(
    attempt: number,
    backoff: 'exponential' | 'linear' | 'constant',
    initialDelay: number,
    maxDelay: number
  ): number {
    let delay: number;

    switch (backoff) {
      case 'exponential':
        delay = initialDelay * Math.pow(2, attempt - 1);
        break;
      case 'linear':
        delay = initialDelay * attempt;
        break;
      case 'constant':
      default:
        delay = initialDelay;
    }

    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    delay = Math.min(delay + jitter, maxDelay);

    return Math.round(delay);
  }
}

// Simple token-based auth provider
export class BearerAuthProvider implements AuthProvider {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async getToken(): Promise<string> {
    return this.token;
  }
}

// OAuth2 auth provider (simplified)
export class OAuth2AuthProvider implements AuthProvider {
  private accessToken: string;
  private refreshTokenValue?: string;
  private tokenEndpoint?: string;
  private clientId?: string;
  private clientSecret?: string;

  constructor(config: {
    accessToken: string;
    refreshToken?: string;
    tokenEndpoint?: string;
    clientId?: string;
    clientSecret?: string;
  }) {
    this.accessToken = config.accessToken;
    this.refreshTokenValue = config.refreshToken;
    this.tokenEndpoint = config.tokenEndpoint;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async getToken(): Promise<string> {
    return this.accessToken;
  }

  async refreshToken(): Promise<string> {
    if (!this.refreshTokenValue || !this.tokenEndpoint) {
      throw new Error('Cannot refresh token: missing refresh token or endpoint');
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshTokenValue,
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
      }),
    });

    const data = await response.json() as { access_token: string; refresh_token?: string };
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshTokenValue = data.refresh_token;
    }

    return this.accessToken;
  }
}
