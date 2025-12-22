/**
 * Circuit Breaker implementation for HTTP requests.
 *
 * Prevents repeated failures from cascading by automatically detecting
 * failure patterns and "opening" the circuit to fail fast.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

import { CIRCUIT_BREAKER_DEFAULTS } from '../config/index.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting recovery (default: 30000 = 30s) */
  resetTimeout?: number;
  /** Number of successful requests in half-open to close circuit (default: 2) */
  successThreshold?: number;
  /** Time window in ms for counting failures (default: 60000 = 60s) */
  failureWindow?: number;
  /** HTTP status codes to count as failures (default: 500-599) */
  failureStatusCodes?: number[];
  /** Whether to count network errors as failures (default: true) */
  countNetworkErrors?: boolean;
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
  isOpen: boolean;
}

export interface CircuitBreakerEvent {
  source: string;
  endpoint?: string;
  state: CircuitState;
  previousState: CircuitState;
  failures: number;
  reason?: string;
}

export interface CircuitBreakerCallbacks {
  /** Called when circuit opens (too many failures) */
  onOpen?: (event: CircuitBreakerEvent) => void;
  /** Called when circuit closes (recovery successful) */
  onClose?: (event: CircuitBreakerEvent) => void;
  /** Called when circuit enters half-open state */
  onHalfOpen?: (event: CircuitBreakerEvent) => void;
  /** Called when a request is rejected due to open circuit */
  onRejected?: (event: { source: string; endpoint?: string; nextAttemptIn: number }) => void;
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  successes: number;
  failureTimestamps: number[];
  lastFailureTime?: number;
  openedAt?: number;
  config: Required<CircuitBreakerConfig>;
}

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: CIRCUIT_BREAKER_DEFAULTS.FAILURE_THRESHOLD,
  resetTimeout: CIRCUIT_BREAKER_DEFAULTS.RESET_TIMEOUT_MS,
  successThreshold: CIRCUIT_BREAKER_DEFAULTS.SUCCESS_THRESHOLD,
  failureWindow: CIRCUIT_BREAKER_DEFAULTS.FAILURE_WINDOW_MS,
  failureStatusCodes: [...CIRCUIT_BREAKER_DEFAULTS.FAILURE_STATUS_CODES],
  countNetworkErrors: CIRCUIT_BREAKER_DEFAULTS.COUNT_NETWORK_ERRORS,
};

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerError extends Error {
  constructor(
    public readonly source: string,
    public readonly endpoint: string | undefined,
    public readonly nextAttemptIn: number
  ) {
    super(
      `Circuit breaker open for ${source}${endpoint ? `:${endpoint}` : ''}. ` +
        `Next attempt in ${Math.ceil(nextAttemptIn / 1000)}s`
    );
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit breaker for managing failure detection and recovery
 */
export class CircuitBreaker {
  private circuits: Map<string, CircuitEntry> = new Map();
  private callbacks: CircuitBreakerCallbacks = {};
  private defaultConfig: Required<CircuitBreakerConfig>;

  constructor(defaultConfig?: CircuitBreakerConfig) {
    this.defaultConfig = { ...DEFAULT_CONFIG, ...defaultConfig };
  }

  /**
   * Configure circuit breaker for a specific source
   */
  configure(source: string, config: CircuitBreakerConfig): void {
    const key = this.getKey(source);
    const existing = this.circuits.get(key);

    if (existing) {
      existing.config = { ...this.defaultConfig, ...config };
    } else {
      this.circuits.set(key, this.createEntry({ ...this.defaultConfig, ...config }));
    }
  }

  /**
   * Set event callbacks
   */
  setCallbacks(callbacks: CircuitBreakerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Check if a request can proceed (throws if circuit is open)
   */
  canProceed(source: string, endpoint?: string): boolean {
    const entry = this.getOrCreateEntry(source, endpoint);
    const now = Date.now();

    if (entry.state === 'closed') {
      return true;
    }

    if (entry.state === 'open') {
      const timeSinceOpen = now - (entry.openedAt ?? now);

      if (timeSinceOpen >= entry.config.resetTimeout) {
        // Transition to half-open
        this.transitionTo(entry, 'half_open', source, endpoint);
        return true;
      }

      return false;
    }

    // Half-open: allow the request through for testing
    return true;
  }

  /**
   * Ensure request can proceed, throwing CircuitBreakerError if not
   */
  ensureCanProceed(source: string, endpoint?: string): void {
    if (!this.canProceed(source, endpoint)) {
      const entry = this.getOrCreateEntry(source, endpoint);
      const now = Date.now();
      const nextAttemptIn = entry.config.resetTimeout - (now - (entry.openedAt ?? now));

      this.callbacks.onRejected?.({
        source,
        endpoint,
        nextAttemptIn,
      });

      throw new CircuitBreakerError(source, endpoint, nextAttemptIn);
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(source: string, endpoint?: string): void {
    const entry = this.getOrCreateEntry(source, endpoint);

    if (entry.state === 'half_open') {
      entry.successes++;

      if (entry.successes >= entry.config.successThreshold) {
        // Recovery successful, close the circuit
        this.transitionTo(entry, 'closed', source, endpoint);
      }
    } else if (entry.state === 'closed') {
      // Clear old failures from window
      this.pruneOldFailures(entry);
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(source: string, endpoint?: string, statusCode?: number, isNetworkError = false): void {
    const entry = this.getOrCreateEntry(source, endpoint);
    const config = entry.config;

    // Check if this failure type should be counted
    const isFailureStatus = statusCode !== undefined && config.failureStatusCodes.includes(statusCode);
    const shouldCount = isFailureStatus || (isNetworkError && config.countNetworkErrors);

    if (!shouldCount) {
      return;
    }

    const now = Date.now();

    if (entry.state === 'half_open') {
      // Any failure in half-open immediately re-opens circuit
      this.transitionTo(entry, 'open', source, endpoint, 'Failure during recovery attempt');
      return;
    }

    if (entry.state === 'closed') {
      // Prune old failures and add new one
      this.pruneOldFailures(entry);
      entry.failureTimestamps.push(now);
      entry.failures = entry.failureTimestamps.length;
      entry.lastFailureTime = now;

      // Check if we should open the circuit
      if (entry.failures >= config.failureThreshold) {
        this.transitionTo(
          entry,
          'open',
          source,
          endpoint,
          `${entry.failures} failures in ${config.failureWindow}ms window`
        );
      }
    }
  }

  /**
   * Get current status for a source/endpoint
   */
  getStatus(source: string, endpoint?: string): CircuitBreakerStatus {
    const entry = this.getOrCreateEntry(source, endpoint);
    const now = Date.now();

    let nextAttemptTime: Date | undefined;
    if (entry.state === 'open' && entry.openedAt) {
      const nextAttemptMs = entry.openedAt + entry.config.resetTimeout;
      nextAttemptTime = new Date(nextAttemptMs);
    }

    return {
      state: entry.state,
      failures: entry.failures,
      successes: entry.successes,
      lastFailureTime: entry.lastFailureTime ? new Date(entry.lastFailureTime) : undefined,
      nextAttemptTime,
      isOpen: entry.state === 'open',
    };
  }

  /**
   * Force reset a circuit to closed state
   */
  reset(source: string, endpoint?: string): void {
    const key = this.getKey(source, endpoint);
    const entry = this.circuits.get(key);

    if (entry) {
      const previousState = entry.state;
      entry.state = 'closed';
      entry.failures = 0;
      entry.successes = 0;
      entry.failureTimestamps = [];
      entry.lastFailureTime = undefined;
      entry.openedAt = undefined;

      if (previousState !== 'closed') {
        this.callbacks.onClose?.({
          source,
          endpoint,
          state: 'closed',
          previousState,
          failures: 0,
          reason: 'Manual reset',
        });
      }
    }
  }

  /**
   * Get all circuit statuses
   */
  getAllStatuses(): Map<string, CircuitBreakerStatus> {
    const result = new Map<string, CircuitBreakerStatus>();

    for (const [key, entry] of this.circuits) {
      const [source, endpoint] = key.split(':');
      result.set(key, this.getStatus(source, endpoint === '' ? undefined : endpoint));
    }

    return result;
  }

  private getKey(source: string, endpoint?: string): string {
    return endpoint ? `${source}:${endpoint}` : source;
  }

  private createEntry(config: Required<CircuitBreakerConfig>): CircuitEntry {
    return {
      state: 'closed',
      failures: 0,
      successes: 0,
      failureTimestamps: [],
      config,
    };
  }

  private getOrCreateEntry(source: string, endpoint?: string): CircuitEntry {
    const key = this.getKey(source, endpoint);
    let entry = this.circuits.get(key);

    if (!entry) {
      // Check for source-level config
      const sourceEntry = this.circuits.get(source);
      const config = sourceEntry?.config ?? this.defaultConfig;
      entry = this.createEntry(config);
      this.circuits.set(key, entry);
    }

    return entry;
  }

  private pruneOldFailures(entry: CircuitEntry): void {
    const now = Date.now();
    const windowStart = now - entry.config.failureWindow;
    entry.failureTimestamps = entry.failureTimestamps.filter((ts) => ts >= windowStart);
    entry.failures = entry.failureTimestamps.length;
  }

  private transitionTo(
    entry: CircuitEntry,
    newState: CircuitState,
    source: string,
    endpoint?: string,
    reason?: string
  ): void {
    const previousState = entry.state;
    entry.state = newState;

    const event: CircuitBreakerEvent = {
      source,
      endpoint,
      state: newState,
      previousState,
      failures: entry.failures,
      reason,
    };

    switch (newState) {
      case 'open':
        entry.openedAt = Date.now();
        entry.successes = 0;
        this.callbacks.onOpen?.(event);
        break;

      case 'half_open':
        entry.successes = 0;
        this.callbacks.onHalfOpen?.(event);
        break;

      case 'closed':
        entry.failures = 0;
        entry.successes = 0;
        entry.failureTimestamps = [];
        entry.lastFailureTime = undefined;
        entry.openedAt = undefined;
        this.callbacks.onClose?.(event);
        break;
    }
  }
}
