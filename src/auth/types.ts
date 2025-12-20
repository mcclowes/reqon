/**
 * Auth provider interface - abstracts token retrieval and refresh
 */
export interface AuthProvider {
  /** Get a valid access token (refreshing if needed) */
  getToken(): Promise<string>;

  /** Force a token refresh */
  refreshToken?(): Promise<string>;

  /** Get token metadata (for monitoring) */
  getTokenInfo?(): TokenInfo;
}

export interface TokenInfo {
  /** When the access token expires */
  expiresAt?: Date;
  /** When the refresh token expires (for non-use expiry tracking) */
  refreshExpiresAt?: Date;
  /** Last time the token was successfully used */
  lastUsedAt?: Date;
  /** Connection/tenant identifier */
  connectionId?: string;
}

/**
 * OAuth2 token set - what gets stored
 */
export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  refreshExpiresAt?: Date;
  tokenType?: string;
  scope?: string;
}

/**
 * Token store interface - pluggable storage backend
 */
export interface TokenStore {
  /** Get tokens for a connection */
  get(connectionId: string): Promise<OAuth2Tokens | null>;

  /** Store tokens for a connection */
  set(connectionId: string, tokens: OAuth2Tokens): Promise<void>;

  /** Delete tokens for a connection */
  delete(connectionId: string): Promise<void>;

  /** Update last used timestamp */
  touch(connectionId: string): Promise<void>;

  /** List all connections (for proactive refresh) */
  list(): Promise<string[]>;
}

/**
 * OAuth2 configuration for token refresh
 */
export interface OAuth2Config {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  /** Seconds before expiry to trigger refresh (default: 300 = 5 min) */
  refreshBuffer?: number;
}

/**
 * Rate limit information extracted from response headers
 */
export interface RateLimitInfo {
  /** Requests remaining in current window */
  remaining?: number;
  /** Total requests allowed in window */
  limit?: number;
  /** When the rate limit resets (Unix timestamp or Date) */
  resetAt?: Date;
  /** Retry after N seconds (from 429 response) */
  retryAfter?: number;
}

/**
 * Rate limit strategy
 */
export type RateLimitStrategy = 'pause' | 'throttle' | 'fail';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Strategy when rate limited (default: 'pause') */
  strategy?: RateLimitStrategy;
  /** Max seconds to wait before failing (default: 300) */
  maxWait?: number;
  /** Log warning after waiting this many seconds (default: 10) */
  notifyAt?: number;
  /** Fallback rate limit if no headers (requests per minute) */
  fallbackRpm?: number;
}

/**
 * Rate limit event - emitted when rate limiting occurs
 */
export interface RateLimitEvent {
  source: string;
  endpoint?: string;
  waitSeconds: number;
  remaining?: number;
  resetAt?: Date;
  strategy: RateLimitStrategy;
}

/**
 * Rate limit event handlers
 */
export interface RateLimitCallbacks {
  /** Called when rate limited and waiting */
  onRateLimited?: (event: RateLimitEvent) => void;
  /** Called when rate limit wait is complete */
  onResumed?: (event: { source: string; endpoint?: string; waitedSeconds: number }) => void;
  /** Called periodically during long waits */
  onWaiting?: (event: RateLimitEvent & { elapsedSeconds: number }) => void;
}

/**
 * Rate limiter interface - tracks and enforces rate limits
 */
export interface RateLimiter {
  /** Check if we should proceed with a request */
  canProceed(source: string, endpoint?: string): Promise<boolean>;

  /** Wait until we can proceed (blocks if rate limited) */
  waitForCapacity(source: string, endpoint?: string): Promise<void>;

  /** Record rate limit info from a response */
  recordResponse(source: string, info: RateLimitInfo, endpoint?: string): void;

  /** Get current rate limit status */
  getStatus(source: string, endpoint?: string): RateLimitStatus;

  /** Configure rate limiting for a source */
  configure(source: string, config: RateLimitConfig): void;

  /** Set event callbacks */
  setCallbacks(callbacks: RateLimitCallbacks): void;

  /** Get delay for throttle mode (returns 0 if no throttling needed) */
  getThrottleDelay(source: string, endpoint?: string): number;
}

export interface RateLimitStatus {
  remaining?: number;
  limit?: number;
  resetAt?: Date;
  isLimited: boolean;
  /** Seconds until reset (if limited) */
  resetInSeconds?: number;
}
