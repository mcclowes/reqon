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
import { laneSource } from './lane.js';

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
  /**
   * Open the circuit when this percentage of requests in the window failed,
   * instead of on an absolute count.
   *
   * An absolute `failureThreshold` cannot be tuned for a bulk run: at a few
   * thousand requests a second, five failures is a rounding error rather than
   * an outage, so a count-based circuit sits permanently open. Set this (with
   * `minimumRequests`) for high-volume sources and the breaker tracks health
   * rather than raw incidents.
   */
  failureRate?: number;
  /**
   * Requests required in the window before `failureRate` is consulted, so a
   * cold start of three failures is not mistaken for a 100% failure rate.
   * (default: 20)
   */
  minimumRequests?: number;
  /**
   * Time in ms a half-open probe may be outstanding before another probe is
   * admitted (default: 30000). A probe slot that is never explicitly released -
   * because a request threw before reporting its outcome, say - would otherwise
   * wedge the circuit in half-open forever. Expiring the slot makes that
   * self-heal.
   */
  probeTimeout?: number;
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
  /** Only tracked when a failureRate is configured - the denominator. */
  successTimestamps: number[];
  lastFailureTime?: number;
  openedAt?: number;
  /**
   * Timestamp (ms) at which the current half-open probe was admitted, or
   * undefined when no probe is outstanding. A timestamp rather than a boolean so
   * a stale probe (never released because its request threw before reporting)
   * can expire after `config.probeTimeout` instead of wedging the circuit.
   */
  probeStartedAt?: number;
  /** Timestamp of the last state-changing activity, used for eviction. */
  lastActivity: number;
  config: Required<CircuitBreakerConfig>;
}

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: CIRCUIT_BREAKER_DEFAULTS.FAILURE_THRESHOLD,
  resetTimeout: CIRCUIT_BREAKER_DEFAULTS.RESET_TIMEOUT_MS,
  successThreshold: CIRCUIT_BREAKER_DEFAULTS.SUCCESS_THRESHOLD,
  failureWindow: CIRCUIT_BREAKER_DEFAULTS.FAILURE_WINDOW_MS,
  failureStatusCodes: [...CIRCUIT_BREAKER_DEFAULTS.FAILURE_STATUS_CODES],
  countNetworkErrors: CIRCUIT_BREAKER_DEFAULTS.COUNT_NETWORK_ERRORS,
  failureRate: 0, // 0 = disabled, fall back to the absolute threshold
  minimumRequests: 20,
  probeTimeout: CIRCUIT_BREAKER_DEFAULTS.PROBE_TIMEOUT_MS,
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
    // Read-only: an unknown key is implicitly closed and must not be inserted
    // (otherwise every probed endpoint leaks an entry forever).
    const entry = this.getEntry(source, endpoint);
    if (!entry) {
      return true;
    }

    const now = Date.now();

    if (entry.state === 'closed') {
      return true;
    }

    if (entry.state === 'open') {
      const timeSinceOpen = now - (entry.openedAt ?? now);

      if (timeSinceOpen >= entry.config.resetTimeout) {
        // Transition to half-open and let this single caller be the probe.
        this.transitionTo(entry, 'half_open', source, endpoint);
        entry.probeStartedAt = now;
        return true;
      }

      return false;
    }

    // Half-open: allow exactly one probe at a time. Every other request is
    // denied until the in-flight probe resolves (success closes the circuit or
    // advances the count; failure re-opens it), preventing a recovery stampede.
    //
    // The probe slot expires after `probeTimeout`: if a probe's outcome is never
    // reported (its request threw before recordSuccess/recordFailure ran), the
    // slot would otherwise stay claimed forever and the circuit would wedge in
    // half-open — never open, so resetTimeout can't re-arm it, and never
    // admitting another probe. Expiry lets the next caller probe instead.
    if (
      entry.probeStartedAt !== undefined &&
      now - entry.probeStartedAt < entry.config.probeTimeout
    ) {
      return false;
    }
    entry.probeStartedAt = now;
    return true;
  }

  /**
   * Ensure request can proceed, throwing CircuitBreakerError if not
   */
  ensureCanProceed(source: string, endpoint?: string): void {
    if (!this.canProceed(source, endpoint)) {
      // canProceed only returns false for an existing open/half-open entry.
      const entry = this.getEntry(source, endpoint);
      const config = entry?.config ?? this.defaultConfig;
      const now = Date.now();
      const nextAttemptIn = config.resetTimeout - (now - (entry?.openedAt ?? now));

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
    // Read-only lookup: a success on an untracked (implicitly closed) endpoint
    // has nothing to record, so don't allocate an entry for it. Rate mode is
    // the exception - successes are the denominator, so they must be counted
    // from the first one. Keys are lane-scoped, so this stays bounded.
    let entry = this.getEntry(source, endpoint);
    if (!entry && this.resolveConfig(source).failureRate > 0) {
      entry = this.getOrCreateEntry(source, endpoint);
    }
    if (!entry) {
      return;
    }
    entry.lastActivity = Date.now();

    if (entry.state === 'half_open') {
      entry.successes++;

      if (entry.successes >= entry.config.successThreshold) {
        // Recovery successful, close the circuit
        this.transitionTo(entry, 'closed', source, endpoint);
      } else {
        // Probe succeeded but more are needed; release the slot for the next.
        entry.probeStartedAt = undefined;
      }
    } else if (entry.state === 'closed') {
      this.pruneOldFailures(entry);
      if (entry.config.failureRate > 0) {
        entry.successTimestamps.push(Date.now());
      }
    }
  }

  /** Config a key would resolve to, without allocating an entry for it. */
  private resolveConfig(source: string): Required<CircuitBreakerConfig> {
    const sourceEntry = this.circuits.get(source) ?? this.circuits.get(laneSource(source));
    return sourceEntry?.config ?? this.defaultConfig;
  }

  /**
   * Record a failed request
   */
  recordFailure(
    source: string,
    endpoint?: string,
    statusCode?: number,
    isNetworkError = false
  ): void {
    // Resolve config without forcing an entry — ignored failures (e.g. a 404)
    // must not allocate a permanent circuit for an otherwise-untracked endpoint.
    // Mirror recordSuccess/getOrCreateEntry and fall back through the lane source
    // (`api@host:port` -> `api`): http.ts keys the breaker per egress lane while
    // the mission configures thresholds under the bare source name, so without
    // this fallback a lane failure would silently use the default config and
    // ignore a configured failureStatusCodes / countNetworkErrors.
    const existing = this.getEntry(source, endpoint);
    const config = existing?.config ?? this.resolveConfig(source);

    // Check if this failure type should be counted
    const isFailureStatus =
      statusCode !== undefined && config.failureStatusCodes.includes(statusCode);
    const shouldCount = isFailureStatus || (isNetworkError && config.countNetworkErrors);

    if (!shouldCount) {
      // An uncounted failure (a 404, or a 4xx we don't treat as an outage) is
      // still a failed probe: it must release a half-open slot, or the circuit
      // wedges in half-open forever (never re-opened, never re-probed). Leaving
      // it half-open means the next request becomes a fresh probe rather than
      // being fast-failed against an inconclusive outcome.
      if (existing?.state === 'half_open') {
        existing.probeStartedAt = undefined;
        existing.lastActivity = Date.now();
      }
      return;
    }

    const entry = existing ?? this.getOrCreateEntry(source, endpoint);
    const now = Date.now();
    entry.lastActivity = now;

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

      const reason = this.openReason(entry, config);
      if (reason) {
        this.transitionTo(entry, 'open', source, endpoint, reason);
      }
    }
  }

  /**
   * Get current status for a source/endpoint
   */
  getStatus(source: string, endpoint?: string): CircuitBreakerStatus {
    // Read-only: querying an unknown circuit must not create one.
    const entry = this.getEntry(source, endpoint);
    if (!entry) {
      return { state: 'closed', failures: 0, successes: 0, isOpen: false };
    }
    return this.statusFromEntry(entry);
  }

  private statusFromEntry(entry: CircuitEntry): CircuitBreakerStatus {
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
      entry.probeStartedAt = undefined;
      entry.lastActivity = Date.now();

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

    // Build the status from each entry directly. Splitting the key on ':' would
    // corrupt URL-shaped keys (e.g. `https://x` → source `https`), and routing
    // back through getStatus is needless. We never mutate `circuits` here.
    for (const [key, entry] of this.circuits) {
      result.set(key, this.statusFromEntry(entry));
    }

    return result;
  }

  /**
   * Evict stale closed circuits to bound memory. Open and half-open circuits
   * are always retained (they carry active backoff/recovery state).
   *
   * @param maxAgeMs Remove closed entries with no activity for this long.
   * @returns Number of entries evicted.
   */
  evictStale(maxAgeMs: number = this.defaultConfig.failureWindow): number {
    const cutoff = Date.now() - maxAgeMs;
    let evicted = 0;
    // Collect first, then delete — never mutate the map mid-iteration.
    const toDelete: string[] = [];
    for (const [key, entry] of this.circuits) {
      if (entry.state === 'closed' && entry.lastActivity < cutoff) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.circuits.delete(key);
      evicted++;
    }
    return evicted;
  }

  private getKey(source: string, endpoint?: string): string {
    return endpoint ? `${source}:${endpoint}` : source;
  }

  /**
   * Why the circuit should open, or undefined to stay closed.
   *
   * Rate mode needs a minimum sample: three failures out of three requests is
   * 100%, but it is not evidence of an outage, and opening there would make a
   * cold start self-defeating.
   */
  private openReason(
    entry: CircuitEntry,
    config: Required<CircuitBreakerConfig>
  ): string | undefined {
    if (config.failureRate > 0) {
      const total = entry.failures + entry.successTimestamps.length;
      if (total < config.minimumRequests) return undefined;

      const rate = (entry.failures / total) * 100;
      return rate >= config.failureRate
        ? `${rate.toFixed(1)}% of ${total} requests failed in ${config.failureWindow}ms window`
        : undefined;
    }

    return entry.failures >= config.failureThreshold
      ? `${entry.failures} failures in ${config.failureWindow}ms window`
      : undefined;
  }

  private createEntry(config: Required<CircuitBreakerConfig>): CircuitEntry {
    return {
      state: 'closed',
      failures: 0,
      successes: 0,
      failureTimestamps: [],
      successTimestamps: [],
      probeStartedAt: undefined,
      lastActivity: Date.now(),
      config,
    };
  }

  /** Read-only lookup. Never inserts — used by status/probe-check paths. */
  private getEntry(source: string, endpoint?: string): CircuitEntry | undefined {
    return this.circuits.get(this.getKey(source, endpoint));
  }

  private getOrCreateEntry(source: string, endpoint?: string): CircuitEntry {
    const key = this.getKey(source, endpoint);
    let entry = this.circuits.get(key);

    if (!entry) {
      // Check for source-level config. The lane fallback matters because
      // http.ts addresses the breaker per egress IP (`api@host:port`) while the
      // mission configures thresholds under the source name alone.
      const sourceEntry = this.circuits.get(source) ?? this.circuits.get(laneSource(source));
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
    if (entry.config.failureRate > 0) {
      entry.successTimestamps = entry.successTimestamps.filter((ts) => ts >= windowStart);
    }
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
    entry.lastActivity = Date.now();
    // Any state change clears the half-open probe slot; canProceed re-claims it
    // when it admits the next probe.
    entry.probeStartedAt = undefined;

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
