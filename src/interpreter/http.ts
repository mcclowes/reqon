import type { RetryConfig } from '../ast/nodes.js';
import type { RateLimiter } from '../auth/types.js';
import { parseRateLimitHeaders } from '../auth/rate-limiter.js';
import { CircuitBreaker, CircuitBreakerError } from '../auth/circuit-breaker.js';
import { laneKey } from '../auth/lane.js';
import { sleep } from '../utils/async.js';
import { HTTP_RETRY_DEFAULTS } from '../config/index.js';
import { FetchError } from '../errors/index.js';
import type { ProxyPool } from './proxy.js';

/**
 * Parse a `Retry-After` header into a delay in ms, clamped to `maxDelayMs`.
 * The header may be delta-seconds (`120`) or an HTTP-date; a date in the past or
 * an unparseable value yields 0 and `undefined` respectively. Clamping stops a
 * hostile/broken server from pinning the client for hours, and the date branch
 * stops `parseInt` from turning a date into `NaN` → `sleep(NaN)` → a tight loop.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  maxDelayMs: number
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  let ms: number;
  if (trimmed !== '' && Number.isFinite(seconds)) {
    ms = seconds * 1000;
  } else {
    const when = Date.parse(trimmed);
    if (Number.isNaN(when)) return undefined;
    ms = when - Date.now();
  }
  return Math.min(Math.max(ms, 0), maxDelayMs);
}

/** Maximum buffered response body size (10 MiB) before the request is rejected. */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface HttpClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: AuthProvider;
  rateLimiter?: RateLimiter;
  circuitBreaker?: CircuitBreaker;
  /** Source name for rate limit and circuit breaker tracking */
  sourceName?: string;
  /** Default per-request timeout in ms (overridden by RetryConfig.timeout) */
  timeout?: number;
  /**
   * Egress proxies to rotate through. Each attempt leaves via the next proxy in
   * the pool, and rate limit / circuit breaker state is tracked per proxy so one
   * IP's 429s or failures don't throttle or trip the rest.
   */
  proxyPool?: ProxyPool;
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
  /**
   * Opt a non-idempotent request (POST/PATCH) into automatic retries by
   * supplying an idempotency key. Sent as the `Idempotency-Key` header so the
   * server can dedup a re-sent write.
   */
  idempotencyKey?: string;
  /**
   * Statuses to treat as a normal response rather than a failure. An allowed
   * status short-circuits the retry, refresh and error paths below and is
   * reported to the circuit breaker as a success - the server answered
   * correctly, we simply asked about something that isn't there.
   */
  allow?: number[];
}

/** HTTP methods that are safe to retry automatically (idempotent per RFC 7231). */
const IDEMPOTENT_METHODS: ReadonlySet<HttpRequest['method']> = new Set(['GET', 'PUT', 'DELETE']);

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

  async request<T = unknown>(req: HttpRequest, retry?: RetryConfig): Promise<HttpResponse<T>> {
    const url = this.buildUrl(req.path, req.query);
    const requestHeaders = { ...req.headers };
    if (req.idempotencyKey) {
      requestHeaders['Idempotency-Key'] = req.idempotencyKey;
    }
    const headers = await this.buildHeaders(requestHeaders);

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
    };

    // Auto-retry only idempotent verbs, or any verb carrying an idempotency key.
    // A blind retry of POST/PATCH can re-send a write the server already
    // committed (timeout / dropped socket after commit), duplicating data.
    const retriable = IDEMPOTENT_METHODS.has(req.method) || Boolean(req.idempotencyKey);

    const maxAttempts = retry?.maxAttempts ?? HTTP_RETRY_DEFAULTS.MAX_ATTEMPTS;
    const backoff = retry?.backoff ?? HTTP_RETRY_DEFAULTS.BACKOFF;
    const initialDelay = retry?.initialDelay ?? HTTP_RETRY_DEFAULTS.INITIAL_DELAY_MS;
    const maxDelay = retry?.maxDelay ?? HTTP_RETRY_DEFAULTS.MAX_DELAY_MS;
    const timeout = retry?.timeout ?? this.config.timeout ?? HTTP_RETRY_DEFAULTS.TIMEOUT_MS;

    let lastError: Error | null = null;
    // Refresh the token at most once per request to avoid burning a fresh
    // rotating refresh token on every 401 retry attempt.
    let hasRefreshed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Outside the try on purpose. A proxy that can't be constructed is a
      // configuration fault, not a transient network error: retrying it wastes
      // attempts, and swallowing it would silently fall back to direct egress
      // and leak the real IP the pool exists to hide.
      const lane = await this.config.proxyPool?.acquire();
      // Resilience state is per egress IP. Sharing one key across a pool would
      // throttle every proxy to a single IP's budget and let one bad proxy trip
      // the breaker for all of them.
      const requestLane = this.config.sourceName
        ? laneKey(this.config.sourceName, lane?.label)
        : undefined;

      try {
        // Check the circuit breaker before each attempt; state may have changed
        // during a retry backoff. Throws CircuitBreakerError if open, which the
        // catch below re-throws rather than retrying.
        //
        // Scoped to the lane, not the path. req.path is interpolated per
        // iteration, so a fan-out over `/entry/{id}/` would file every request
        // under its own key: the throttle would never see a previous request to
        // pace against and the breaker would never accumulate to its threshold.
        if (this.config.circuitBreaker && requestLane) {
          this.config.circuitBreaker.ensureCanProceed(requestLane);
        }

        // Wait for rate limit capacity if we have a rate limiter
        if (this.config.rateLimiter && requestLane) {
          await this.config.rateLimiter.waitForCapacity(requestLane);
        }

        const attemptOptions = lane
          ? ({ ...fetchOptions, dispatcher: lane.dispatcher } as RequestInit)
          : fetchOptions;
        // Dispatch through the fetch that owns this dispatcher; see
        // ProxyLane.fetchImpl. Falls back to global fetch off the proxy path.
        const response = await this.fetchWithTimeout(
          url,
          attemptOptions,
          timeout,
          req.method,
          lane?.fetchImpl ?? fetch
        );

        // Extract and record rate limit info from response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        if (this.config.rateLimiter && requestLane) {
          const rateLimitInfo = parseRateLimitHeaders(responseHeaders);

          // Add retry-after from 429 responses
          if (response.status === 429) {
            const ms = parseRetryAfterMs(response.headers.get('Retry-After'), maxDelay);
            if (ms !== undefined) {
              rateLimitInfo.retryAfter = Math.ceil(ms / 1000);
            }
          }

          this.config.rateLimiter.recordResponse(requestLane, rateLimitInfo);
        }

        // An allowed status is data. Decided before the retry and error paths
        // so `allow: [404]` costs one request, not maxAttempts of them.
        if (req.allow?.includes(response.status)) {
          if (this.config.circuitBreaker && requestLane) {
            this.config.circuitBreaker.recordSuccess(requestLane);
          }
          return {
            status: response.status,
            data: await this.parseResponseBody<T>(response, url, req.method),
            headers: responseHeaders,
          };
        }

        // Handle rate limiting: retry only while attempts remain. A 429 on the
        // final attempt falls through to the >=400 handler below, which throws a
        // FetchError carrying status 429 — not the generic "all retries" error.
        if (response.status === 429 && retriable && attempt < maxAttempts) {
          const delay =
            parseRetryAfterMs(response.headers.get('Retry-After'), maxDelay) ??
            this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          await sleep(delay);
          continue;
        }

        // Handle server errors with retry
        if (response.status >= 500) {
          // Record failure in circuit breaker
          if (this.config.circuitBreaker && requestLane) {
            this.config.circuitBreaker.recordFailure(requestLane, undefined, response.status);
          }

          if (retriable && attempt < maxAttempts) {
            const delay = this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
            await sleep(delay);
            continue;
          }
          // Non-idempotent without an idempotency key: do not re-send a write
          // that the server may have already committed. Return the 5xx instead.
        }

        // Handle 401 - try token refresh (at most once per request)
        if (
          response.status === 401 &&
          this.config.auth?.refreshToken &&
          !hasRefreshed &&
          attempt < maxAttempts
        ) {
          hasRefreshed = true;
          await this.config.auth.refreshToken();
          // Rebuild headers with new token (preserving the idempotency key)
          const newHeaders = await this.buildHeaders(requestHeaders);
          fetchOptions.headers = newHeaders;
          continue;
        }

        // Any remaining non-2xx/3xx response is an error: a 4xx (other than the
        // 429/401-refresh cases handled above) or a 5xx that exhausted retries.
        // Returning it as `data` would let map/store persist an API error body.
        if (response.status >= 400) {
          const snippet = await this.safeReadSnippet(response);
          throw new FetchError(
            `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}` +
              (snippet ? `: ${snippet}` : ''),
            { url, method: req.method, statusCode: response.status }
          );
        }

        const data = await this.parseResponseBody<T>(response, url, req.method);

        // Record success in circuit breaker
        if (this.config.circuitBreaker && requestLane && response.status < 500) {
          this.config.circuitBreaker.recordSuccess(requestLane);
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

        // HTTP-status errors (4xx, exhausted 5xx) and body parse/size errors
        // are definitive — don't burn retries re-fetching them.
        if (error instanceof FetchError && error.statusCode !== undefined) {
          throw error;
        }

        // Record network errors in circuit breaker
        if (this.config.circuitBreaker && requestLane) {
          this.config.circuitBreaker.recordFailure(requestLane, undefined, undefined, true);
        }

        // A network error on a non-idempotent write is ambiguous: the request
        // may have reached the server and committed before the socket dropped.
        // Surface the error rather than blindly re-sending a duplicate write.
        if (!retriable) {
          throw lastError;
        }

        if (attempt < maxAttempts) {
          const delay = this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Request failed after all retries');
  }

  /**
   * Run a fetch with a per-attempt timeout. Aborts the request (freeing the
   * connection and rate-limiter slot) if it exceeds `timeoutMs`, surfacing a
   * retryable FetchError rather than hanging forever.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number,
    method: string,
    fetchImpl: typeof globalThis.fetch = fetch
  ): Promise<Response> {
    if (!timeoutMs || timeoutMs <= 0) {
      return fetchImpl(url, options);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new FetchError(`Request timed out after ${timeoutMs}ms`, {
          url,
          method,
          cause: error as Error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parse a successful (2xx) response body. Handles empty/204 responses,
   * returns non-JSON content as raw text, and caps the buffered size.
   */
  private async parseResponseBody<T>(response: Response, url: string, method: string): Promise<T> {
    // No-content responses have no body to parse.
    if (response.status === 204 || response.status === 205) {
      return null as T;
    }

    const text = await this.readCappedText(response, url, method);
    if (text.trim() === '') {
      return null as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const looksJson = contentType === '' || contentType.includes('json');

    try {
      return JSON.parse(text) as T;
    } catch (parseError) {
      // A non-JSON content-type (text/html, text/plain, …) is returned as-is
      // rather than throwing — only fail when the body claimed to be JSON.
      if (!looksJson) {
        return text as T;
      }
      throw new FetchError(
        `Failed to parse JSON response (content-type '${contentType}'): ${(parseError as Error).message}`,
        { url, method, statusCode: response.status, cause: parseError as Error }
      );
    }
  }

  /** Read a response body to text, rejecting once it exceeds MAX_RESPONSE_BYTES. */
  private async readCappedText(response: Response, url: string, method: string): Promise<string> {
    const body = response.body;
    if (!body) {
      return await response.text();
    }
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new FetchError(`Response body exceeds ${MAX_RESPONSE_BYTES} bytes`, {
            url,
            method,
            statusCode: response.status,
          });
        }
        chunks.push(Buffer.from(value));
      }
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  /** Read a short snippet of a body for an error message (best-effort). */
  private async safeReadSnippet(response: Response): Promise<string> {
    try {
      const text = await response.text();
      const trimmed = text.trim();
      return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    } catch {
      return '';
    }
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

  private async buildHeaders(
    requestHeaders?: Record<string, string>
  ): Promise<Record<string, string>> {
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
  /** Single-flight guard: coalesces concurrent refreshes into one in-flight request */
  private refreshPromise: Promise<string> | null = null;

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
    // Deduplicate concurrent refresh requests. With rotating refresh tokens,
    // letting many in-flight requests each POST to the token endpoint would
    // 400 invalid_grant all but one and kill the session.
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<string> {
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

    const data = (await response.json()) as { access_token: string; refresh_token?: string };
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshTokenValue = data.refresh_token;
    }

    return this.accessToken;
  }
}
