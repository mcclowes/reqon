import { z } from 'zod';
import type { RetryConfig } from '../ast/nodes.js';
import type { RateLimiter } from '../auth/types.js';
import { parseRateLimitHeaders, parseRetryAfterMs } from '../auth/rate-limiter.js';
import { CircuitBreaker, CircuitBreakerError } from '../auth/circuit-breaker.js';
import { laneKey } from '../auth/lane.js';
import { sleep } from '../utils/async.js';
import { HTTP_RETRY_DEFAULTS } from '../config/index.js';
import { FetchError } from '../errors/index.js';
import type { ProxyPool } from './proxy.js';

// Re-exported for compatibility: the parser lives with the other header
// parsing in auth/rate-limiter.ts so both consumers share one implementation.
export { parseRetryAfterMs };

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
  /**
   * Notified before each retry backoff, so observers can surface a retry count.
   * Retries happen inside this loop, invisible to the caller otherwise.
   */
  onRetry?: (info: RetryInfo) => void;
}

/** A single retry attempt about to be made after a backoff. */
export interface RetryInfo {
  source?: string;
  path: string;
  /** The attempt that just failed (1-based); the retry is `attempt + 1`. */
  attempt: number;
  maxAttempts: number;
  /** Why the attempt is being retried: an HTTP status or a network reason. */
  reason: string;
  /** Backoff before the next attempt, in ms. */
  waitMs: number;
}

/**
 * The header(s) and/or query param(s) a provider adds to authenticate a request.
 * Lets schemes other than `Authorization: Bearer` (Basic, an API key in a custom
 * header or a query param) participate without the client hardcoding one shape.
 */
export interface AuthContribution {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface AuthProvider {
  getToken(): Promise<string>;
  refreshToken?(): Promise<string>;
  /**
   * Full auth contribution for a request. Implement this for any scheme that is
   * not `Authorization: Bearer <getToken()>` — Basic auth, or an API key in a
   * custom header or query param. When absent, the client falls back to sending
   * `Authorization: Bearer <getToken()>`.
   */
  applyAuth?(): Promise<AuthContribution>;
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

  /** Notify the retry observer (if any) before a backoff. Never throws. */
  private notifyRetry(
    req: HttpRequest,
    attempt: number,
    maxAttempts: number,
    reason: string,
    waitMs: number
  ): void {
    if (!this.config.onRetry) return;
    try {
      this.config.onRetry({
        source: this.config.sourceName,
        path: req.path,
        attempt,
        maxAttempts,
        reason,
        waitMs,
      });
    } catch {
      // Observability must never break a request.
    }
  }

  async request<T = unknown>(req: HttpRequest, retry?: RetryConfig): Promise<HttpResponse<T>> {
    // Resolve auth once up front: header contributions go into the request
    // headers, query contributions (e.g. an API key in a query param) into the
    // URL. Bearer/OAuth2 contribute a header; Basic and API-key providers may
    // contribute either.
    const auth = await this.resolveAuthContribution();
    const url = this.buildUrl(req.path, this.mergeQuery(req.query, auth?.query));
    const requestHeaders = { ...req.headers };
    if (req.idempotencyKey) {
      requestHeaders['Idempotency-Key'] = req.idempotencyKey;
    }
    const headers = this.buildHeaders(requestHeaders, auth);

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      // Serialize any defined body. A truthiness check would silently drop a
      // legitimate falsy payload (0, false, ""); only null/undefined mean "no body".
      body: req.body != null ? JSON.stringify(req.body) : undefined,
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

          // Flag every 429 so the limiter backs off and calibrates its model,
          // even when the server sends no Retry-After (FPL's OpenResty bucket
          // doesn't). The header, when present, refines the wait.
          if (response.status === 429) {
            rateLimitInfo.rejected = true;
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
          this.notifyRetry(req, attempt, maxAttempts, '429', delay);
          await this.drainBody(response);
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
            this.notifyRetry(req, attempt, maxAttempts, `${response.status}`, delay);
            await this.drainBody(response);
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
          await this.drainBody(response);
          await this.config.auth.refreshToken();
          // Rebuild headers with the refreshed token (preserving the idempotency
          // key). Only header-based schemes refresh, so the URL query is stable.
          const refreshedAuth = await this.resolveAuthContribution();
          fetchOptions.headers = this.buildHeaders(requestHeaders, refreshedAuth);
          continue;
        }

        // Any remaining non-2xx/3xx response is an error: a 4xx (other than the
        // 429/401-refresh cases handled above) or a 5xx that exhausted retries.
        // Returning it as `data` would let map/store persist an API error body.
        if (response.status >= 400) {
          // Report a 4xx to the breaker so it observes the outcome: this releases
          // a half-open probe slot and lets a configured `failureStatusCodes`
          // count auth failures (a revoked key 403ing every request) toward the
          // threshold instead of looping forever (#254). Whether it *counts*
          // stays governed by config. 5xx was already recorded above; recording
          // it here too would double-count, so this is 4xx-only.
          if (
            this.config.circuitBreaker &&
            requestLane &&
            response.status >= 400 &&
            response.status < 500
          ) {
            this.config.circuitBreaker.recordFailure(requestLane, undefined, response.status);
          }
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
          this.notifyRetry(req, attempt, maxAttempts, lastError.message || 'network error', delay);
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

  /**
   * Release an unread response body before abandoning a response on a retry or
   * refresh path. In the fetch API the body is a resource with an ownership
   * contract: if you won't read it, cancel it. Undici otherwise holds the socket
   * until GC, so a retry-heavy run leaks connections and exhausts the pool,
   * surfacing as unexplained timeouts rather than as a leak (#253).
   */
  private async drainBody(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // Best-effort: an already-consumed or errored body has nothing to leak.
    }
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

  /**
   * Resolve the configured auth provider's contribution for a request, or
   * undefined when the source is unauthenticated. A provider that implements
   * `applyAuth` controls its own header/query shape (Basic, API key); otherwise
   * the default is `Authorization: Bearer <getToken()>`.
   */
  private async resolveAuthContribution(): Promise<AuthContribution | undefined> {
    const auth = this.config.auth;
    if (!auth) return undefined;
    if (auth.applyAuth) {
      return auth.applyAuth();
    }
    const token = await auth.getToken();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  /** Merge base query params with auth-provided ones (auth wins on conflict). */
  private mergeQuery(
    base?: Record<string, string>,
    auth?: Record<string, string>
  ): Record<string, string> | undefined {
    if (!auth || Object.keys(auth).length === 0) return base;
    return { ...base, ...auth };
  }

  private buildHeaders(
    requestHeaders?: Record<string, string>,
    auth?: AuthContribution
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.config.headers,
      ...requestHeaders,
    };

    if (auth?.headers) {
      Object.assign(headers, auth.headers);
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

/**
 * HTTP Basic auth: sends `Authorization: Basic base64(username:password)`.
 * Before #200 a `basic` source was silently sent unauthenticated.
 */
export class BasicAuthProvider implements AuthProvider {
  private readonly encoded: string;

  constructor(username: string, password: string) {
    this.encoded = Buffer.from(`${username}:${password}`).toString('base64');
  }

  async getToken(): Promise<string> {
    return this.encoded;
  }

  async applyAuth(): Promise<AuthContribution> {
    return { headers: { Authorization: `Basic ${this.encoded}` } };
  }
}

/**
 * API-key auth: sends the key in a header (default `X-API-Key`) or, when
 * `location: 'query'`, as a query parameter. Before #200 an `api_key` source
 * was silently sent unauthenticated.
 */
export class ApiKeyAuthProvider implements AuthProvider {
  private readonly key: string;
  private readonly paramName: string;
  private readonly location: 'header' | 'query';

  constructor(key: string, options: { name?: string; location?: 'header' | 'query' } = {}) {
    this.key = key;
    this.location = options.location ?? 'header';
    this.paramName = options.name ?? (this.location === 'query' ? 'api_key' : 'X-API-Key');
  }

  async getToken(): Promise<string> {
    return this.key;
  }

  async applyAuth(): Promise<AuthContribution> {
    return this.location === 'query'
      ? { query: { [this.paramName]: this.key } }
      : { headers: { [this.paramName]: this.key } };
  }
}

/** Refresh ahead of expiry at this fraction of the token's lifetime. */
const PROACTIVE_REFRESH_FRACTION = 0.8;

// OAuth2 auth provider (simplified)
export class OAuth2AuthProvider implements AuthProvider {
  private accessToken: string;
  private refreshTokenValue?: string;
  private tokenEndpoint?: string;
  private clientId?: string;
  private clientSecret?: string;
  /** Single-flight guard: coalesces concurrent refreshes into one in-flight request */
  private refreshPromise: Promise<string> | null = null;
  /** Epoch ms after which getToken refreshes proactively (from `expires_in`). */
  private refreshAfter?: number;

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
    // Refresh ahead of a known expiry: a reactive-only refresh costs a wasted
    // request plus a retry on every expiry. Failure falls back to the current
    // token — the 401 path remains the place real refresh errors surface.
    if (this.shouldProactivelyRefresh()) {
      try {
        return await this.refreshToken();
      } catch {
        return this.accessToken;
      }
    }
    return this.accessToken;
  }

  private shouldProactivelyRefresh(): boolean {
    return (
      this.refreshAfter !== undefined &&
      Date.now() >= this.refreshAfter &&
      !!this.refreshTokenValue &&
      !!this.tokenEndpoint
    );
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

    // A failed refresh (e.g. 400 invalid_grant on an expired refresh token) has
    // no access_token. Without this check `accessToken` becomes undefined and
    // every later request sends `Bearer undefined`, turning an expired-token
    // condition into a confusing 401 loop. Surface the real reason instead (#255).
    if (!response.ok) {
      throw new Error(`OAuth2 token refresh failed: ${await describeOAuthError(response)}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(
        `OAuth2 token refresh failed: token endpoint returned a non-JSON body (HTTP ${response.status})`
      );
    }

    // Validate rather than cast. This data crosses a trust boundary; `as` only
    // silences the compiler, it doesn't check that access_token is really there.
    const parsed = OAuth2TokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('OAuth2 token refresh failed: response did not contain a valid access_token');
    }

    this.accessToken = parsed.data.access_token;
    if (parsed.data.refresh_token) {
      this.refreshTokenValue = parsed.data.refresh_token;
    }
    if (parsed.data.expires_in !== undefined && Number.isFinite(parsed.data.expires_in)) {
      this.refreshAfter = Date.now() + parsed.data.expires_in * 1000 * PROACTIVE_REFRESH_FRACTION;
    }

    return this.accessToken;
  }
}

/** Shape of a successful RFC 6749 token response (only the fields we consume). */
const OAuth2TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
});

/**
 * Extract a human-readable reason from an OAuth2 error response. Providers put
 * the real cause in the `error` / `error_description` fields (RFC 6749 §5.2);
 * fall back to the status line when the body isn't the expected JSON.
 */
async function describeOAuthError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; error_description?: string };
    if (body?.error) {
      return body.error_description ? `${body.error} (${body.error_description})` : body.error;
    }
  } catch {
    // Non-JSON body; fall through to the status line.
  }
  return `HTTP ${response.status}`;
}
