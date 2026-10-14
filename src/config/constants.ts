/**
 * Centralized Configuration Constants
 *
 * This module contains all default values and configuration constants used
 * throughout the Reqon framework. Centralizing these values makes it easier
 * to understand, tune, and override defaults.
 */

// ============================================
// HTTP Client Configuration
// ============================================

/**
 * Default retry configuration for HTTP requests
 */
export const HTTP_RETRY_DEFAULTS = {
  /** Maximum number of retry attempts */
  MAX_ATTEMPTS: 3,
  /** Initial delay between retries in milliseconds */
  INITIAL_DELAY_MS: 1000,
  /** Maximum delay between retries in milliseconds */
  MAX_DELAY_MS: 30000,
  /** Backoff strategy: 'exponential', 'linear', or 'constant' */
  BACKOFF: 'exponential' as const,
} as const;

/**
 * General HTTP client defaults (timeouts, response limits, idempotency)
 */
export const HTTP_CLIENT_DEFAULTS = {
  /** Per-request timeout in milliseconds before the request is aborted */
  TIMEOUT_MS: 30000,
  /** Maximum response body size to buffer, in bytes (10 MB) */
  MAX_RESPONSE_BYTES: 10 * 1024 * 1024,
  /**
   * HTTP methods considered safe to retry automatically. Per HTTP semantics
   * GET/HEAD are safe and PUT is idempotent. POST/PATCH/DELETE are excluded by
   * default because a retry can duplicate or repeat a server-side write; callers
   * must opt in via `idempotent: true` or an idempotency key to retry those.
   */
  IDEMPOTENT_METHODS: ['GET', 'HEAD', 'PUT'] as readonly string[],
} as const;

/**
 * Default HTTP headers
 */
export const HTTP_DEFAULT_HEADERS = {
  CONTENT_TYPE: 'application/json',
  ACCEPT: 'application/json',
} as const;

// ============================================
// Rate Limiter Configuration
// ============================================

/**
 * Default rate limiter configuration
 */
export const RATE_LIMIT_DEFAULTS = {
  /** Default strategy when rate limited: 'pause', 'throttle', or 'fail' */
  STRATEGY: 'pause' as const,
  /** Maximum wait time in seconds before timing out */
  MAX_WAIT_SECONDS: 300,
  /** Seconds before starting to notify about ongoing waits */
  NOTIFY_AT_SECONDS: 10,
  /** Fallback requests per minute when no rate limit info available */
  FALLBACK_RPM: 60,
  /** Maximum age for stale rate limit entries (1 hour in ms) */
  MAX_STALE_AGE_MS: 60 * 60 * 1000,
  /** Cleanup interval for stale entries (5 minutes in ms) */
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  /** Number of responses between cleanup checks */
  CLEANUP_CHECK_INTERVAL: 100,
  /** Maximum entries before forced cleanup */
  MAX_ENTRIES_BEFORE_CLEANUP: 1000,
} as const;

// ============================================
// Circuit Breaker Configuration
// ============================================

/**
 * Default circuit breaker configuration
 */
export const CIRCUIT_BREAKER_DEFAULTS = {
  /** Number of failures before opening circuit */
  FAILURE_THRESHOLD: 5,
  /** Time in milliseconds before attempting recovery */
  RESET_TIMEOUT_MS: 30000,
  /** Number of successful requests in half-open to close circuit */
  SUCCESS_THRESHOLD: 2,
  /** Time window in milliseconds for counting failures */
  FAILURE_WINDOW_MS: 60000,
  /** HTTP status codes to count as failures */
  FAILURE_STATUS_CODES: [500, 501, 502, 503, 504] as readonly number[],
  /** Whether to count network errors as failures */
  COUNT_NETWORK_ERRORS: true,
} as const;

// ============================================
// Webhook Server Configuration
// ============================================

/**
 * Default webhook server configuration
 */
export const WEBHOOK_DEFAULTS = {
  /** Default port for webhook server */
  PORT: 3000,
  /**
   * Default host binding. Loopback by default so the server is not exposed on
   * all interfaces without an explicit opt-in. Override via `host` when the
   * webhook must be reachable from outside the host.
   */
  HOST: '127.0.0.1',
  /** Default timeout for wait steps (5 minutes in ms) */
  DEFAULT_TIMEOUT_MS: 300000,
  /** Cleanup interval for expired registrations (1 minute in ms) */
  CLEANUP_INTERVAL_MS: 60000,
  /** Maximum accepted request body size in bytes (1 MB) */
  MAX_BODY_BYTES: 1024 * 1024,
  /** Socket inactivity timeout in milliseconds (30 seconds) */
  SOCKET_TIMEOUT_MS: 30000,
} as const;

// ============================================
// Control Server Configuration
// ============================================

/**
 * Default control server configuration
 */
export const CONTROL_DEFAULTS = {
  /** Default port for control server */
  PORT: 3001,
  /**
   * Default host binding. Loopback by default; the control server exposes
   * state-changing endpoints and full execution state, so it must not bind all
   * interfaces without an explicit opt-in.
   */
  HOST: '127.0.0.1',
  /** Maximum accepted request body size in bytes (64 KB) */
  MAX_BODY_BYTES: 64 * 1024,
  /** Socket inactivity timeout in milliseconds (30 seconds) */
  SOCKET_TIMEOUT_MS: 30000,
} as const;

// ============================================
// Store Configuration
// ============================================

/**
 * Default store configuration
 */
export const STORE_DEFAULTS = {
  /** Default base directory for file stores */
  DATA_DIR: '.reqon-data',
  /** Default subdirectory for executions */
  EXECUTIONS_DIR: 'executions',
  /** Default subdirectory for sync state */
  SYNC_DIR: 'sync',
} as const;

// ============================================
// Scheduler Configuration
// ============================================

/**
 * Default scheduler configuration
 */
export const SCHEDULER_DEFAULTS = {
  /** Default retry configuration for failed scheduled missions */
  MAX_RETRIES: 3,
  /** Default delay between retries in seconds */
  RETRY_DELAY_SECONDS: 60,
} as const;

// ============================================
// Execution Configuration
// ============================================

/**
 * Default execution configuration
 */
export const EXECUTION_DEFAULTS = {
  /** Whether development mode is enabled by default (uses file stores) */
  DEVELOPMENT_MODE: true,
  /** Whether to persist execution state by default */
  PERSIST_STATE: false,
} as const;

// ============================================
// Type Definitions for Configuration
// ============================================

/** Type for rate limit strategy */
export type RateLimitStrategy = 'pause' | 'throttle' | 'fail';

/** Type for retry backoff strategy */
export type BackoffStrategy = 'exponential' | 'linear' | 'constant';

/**
 * Merged configuration type utilities
 */
export type HttpRetryConfig = {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoff?: BackoffStrategy;
};

export type RateLimitConfig = {
  strategy?: RateLimitStrategy;
  maxWait?: number;
  notifyAt?: number;
  fallbackRpm?: number;
};

export type CircuitBreakerConfig = {
  failureThreshold?: number;
  resetTimeout?: number;
  successThreshold?: number;
  failureWindow?: number;
  failureStatusCodes?: number[];
  countNetworkErrors?: boolean;
};

export type WebhookConfig = {
  port?: number;
  host?: string;
  baseUrl?: string;
  defaultTimeout?: number;
  verbose?: boolean;
};
