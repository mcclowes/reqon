import type {
  RateLimiter,
  RateLimitInfo,
  RateLimitStatus,
  RateLimitConfig,
  RateLimitCallbacks,
  RateLimitEvent,
} from './types.js';
import { sleep } from '../utils/async.js';
import { laneSource } from './lane.js';
import { TokenBucketModel } from './rate-model.js';
import { RATE_LIMIT_DEFAULTS } from '../config/index.js';

interface RateLimitState {
  remaining?: number;
  limit?: number;
  resetAt?: Date;
  retryAfter?: Date;
  lastRequestAt?: Date;
}

// `model` has no default - its absence means "no model", so it is omitted from
// the required defaults rather than given a placeholder.
type ResolvedRateLimitConfig = Required<Omit<RateLimitConfig, 'model'>> &
  Pick<RateLimitConfig, 'model'>;

const DEFAULT_CONFIG: Required<Omit<RateLimitConfig, 'model'>> = {
  strategy: RATE_LIMIT_DEFAULTS.STRATEGY,
  maxWait: RATE_LIMIT_DEFAULTS.MAX_WAIT_SECONDS,
  notifyAt: RATE_LIMIT_DEFAULTS.NOTIFY_AT_SECONDS,
  fallbackRpm: RATE_LIMIT_DEFAULTS.FALLBACK_RPM,
};

/**
 * Rate limit timeout error - thrown when maxWait is exceeded
 */
export class RateLimitTimeoutError extends Error {
  constructor(
    public source: string,
    public waitedSeconds: number,
    public maxWait: number
  ) {
    super(`Rate limit timeout: waited ${waitedSeconds}s (max: ${maxWait}s) for ${source}`);
    this.name = 'RateLimitTimeoutError';
  }
}

/**
 * Rate limit error - thrown when strategy is 'fail'
 */
export class RateLimitError extends Error {
  constructor(
    public source: string,
    public resetAt?: Date
  ) {
    const resetIn = resetAt ? Math.ceil((resetAt.getTime() - Date.now()) / 1000) : undefined;
    super(`Rate limited on ${source}${resetIn ? ` - resets in ${resetIn}s` : ''}`);
    this.name = 'RateLimitError';
  }
}

/**
 * Adaptive rate limiter that learns from response headers
 * Supports pause, throttle, and fail strategies
 */
export class AdaptiveRateLimiter implements RateLimiter {
  private state: Map<string, RateLimitState> = new Map();
  /**
   * Next free send slot per egress lane, as an epoch ms timestamp.
   *
   * Deliberately keyed by lane alone, not by endpoint: a sharded fan-out calls
   * a different interpolated path every iteration, and per-path buckets mean
   * every request looks like the first one and the throttle never engages.
   */
  private pacing: Map<string, number> = new Map();
  /**
   * Active Retry-After backoff per egress lane.
   *
   * A 429 is the server objecting to this client, not to the one URL that
   * happened to trip it. Held per lane so a fan-out over thousands of distinct
   * paths actually stops, while a pool's other proxies keep working.
   */
  private laneBackoff: Map<string, Date> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();
  /**
   * A local simulation of the server's limiter, per configured source. When
   * present it drives throttle pacing instead of the flat `fallbackRpm`, so a
   * run uses the server's burst allowance and holds its sustained rate. The
   * model keys its own buckets per lane, so one instance serves a whole pool.
   */
  private models: Map<string, TokenBucketModel> = new Map();
  private callbacks: RateLimitCallbacks = {};
  private lastCleanup: number = Date.now();
  private maxStaleAgeMs: number;
  private responsesSinceCleanup: number = 0;

  constructor(
    private defaultConfig: Partial<RateLimitConfig> = {},
    options: { maxStaleAgeMs?: number } = {}
  ) {
    this.maxStaleAgeMs = options.maxStaleAgeMs ?? RATE_LIMIT_DEFAULTS.MAX_STALE_AGE_MS;
  }

  /**
   * Clean up stale entries from the state map to prevent memory leaks.
   *
   * Eviction is driven by `lastRequestAt`, not `resetAt`. Most of the leak came
   * from keys whose API sends no reset header: `resetAt` is never set, so the
   * old reset-passed condition could never fire and those keys lived forever.
   * Now any key idle longer than the stale threshold is evicted regardless of
   * `resetAt`, except while an active `retryAfter` backoff is still pending
   * (that state must survive so we keep honouring the 429).
   */
  private cleanup(): void {
    const now = Date.now();

    // Skip if cleanup was done recently and we're under the entry limit
    if (
      now - this.lastCleanup < RATE_LIMIT_DEFAULTS.CLEANUP_INTERVAL_MS &&
      this.state.size < RATE_LIMIT_DEFAULTS.MAX_ENTRIES_BEFORE_CLEANUP
    ) {
      return;
    }

    this.lastCleanup = now;
    const nowDate = new Date(now);
    const staleThreshold = new Date(now - this.maxStaleAgeMs);

    for (const [key, state] of this.state) {
      // A pending retry-after backoff must never be evicted out from under us.
      const isRetryPending = state.retryAfter !== undefined && state.retryAfter >= nowDate;
      if (isRetryPending) continue;

      // Stale if the last request is older than the threshold, or if no request
      // was ever recorded for this key.
      const isStale = !state.lastRequestAt || state.lastRequestAt < staleThreshold;

      if (isStale) {
        this.state.delete(key);
      }
    }
  }

  /**
   * Get the number of tracked endpoints (for monitoring)
   */
  getTrackedEndpointCount(): number {
    return this.state.size;
  }

  /**
   * Force cleanup of stale entries
   */
  forceCleanup(): void {
    this.lastCleanup = 0;
    this.cleanup();
  }

  private getKey(source: string, endpoint?: string): string {
    return endpoint ? `${source}:${endpoint}` : source;
  }

  /**
   * Resolve config for a source, falling back to the bare source name when
   * given a proxy lane key. http.ts addresses the limiter per egress IP
   * (`api@proxy-a`) so each IP gets its own budget, but the mission configures
   * limits under the source name alone — without this fallback every pooled
   * request silently runs on defaults instead of the configured limits.
   */
  private getConfig(source: string): ResolvedRateLimitConfig {
    const sourceConfig = this.configs.get(source) ?? this.configs.get(laneSource(source)) ?? {};
    return { ...DEFAULT_CONFIG, ...this.defaultConfig, ...sourceConfig };
  }

  configure(source: string, config: RateLimitConfig): void {
    this.configs.set(source, config);
    if (config.model) {
      this.models.set(source, new TokenBucketModel(config.model));
    } else {
      this.models.delete(source);
    }
  }

  /** Resolve the limiter model for a source or one of its proxy lanes. */
  private getModel(source: string): TokenBucketModel | undefined {
    return this.models.get(source) ?? this.models.get(laneSource(source));
  }

  setCallbacks(callbacks: RateLimitCallbacks): void {
    this.callbacks = callbacks;
  }

  async canProceed(source: string, endpoint?: string): Promise<boolean> {
    const key = this.getKey(source, endpoint);
    const state = this.state.get(key);
    const now = new Date();

    // A 429 anywhere on this lane holds every endpoint on it
    const laneBackoff = this.laneBackoff.get(source);
    if (laneBackoff && laneBackoff > now) {
      return false;
    }
    if (laneBackoff) {
      this.laneBackoff.delete(source);
    }

    if (!state) return true;

    // Check retry-after (from 429)
    if (state.retryAfter && state.retryAfter > now) {
      return false;
    }

    // Check if we've reset
    if (state.resetAt && state.resetAt <= now) {
      // Reset has passed, clear the limit
      this.state.delete(key);
      return true;
    }

    // Check remaining quota
    if (state.remaining !== undefined && state.remaining <= 0) {
      return false;
    }

    return true;
  }

  /**
   * Claim the next send slot on a lane, returning how long to wait for it.
   *
   * Reservation rather than measurement. Measuring "time since the last
   * request" cannot pace concurrent callers: N iterations in flight all read
   * the same timestamp, compute the same delay, and fire as a batch at N times
   * the configured rate. Claiming a slot works because the read-and-advance
   * below is synchronous, so concurrent callers are handed strictly increasing
   * slots and space themselves out.
   */
  private reserveSlot(source: string, endpoint?: string): number {
    const config = this.getConfig(source);
    if (config.strategy !== 'throttle') return 0;

    // A model of the server's limiter governs pacing when configured: it knows
    // the burst allowance and the sustained rate, which a flat rpm can't
    // express. Its bucket is keyed per lane, so `source` (the lane key) is the
    // bucket key.
    const model = this.getModel(source);
    if (model) return model.reserve(source, Date.now());

    // Otherwise honour whichever is more conservative: the configured floor, or
    // the spacing implied by the quota headers this endpoint last reported.
    const intervalMs = Math.max(
      60000 / config.fallbackRpm,
      this.headerIntervalMs(source, endpoint) ?? 0
    );

    const now = Date.now();
    const slot = Math.max(now, this.pacing.get(source) ?? 0);
    this.pacing.set(source, slot + intervalMs);
    return slot - now;
  }

  /** Spacing implied by remaining quota over the time left in the window. */
  private headerIntervalMs(source: string, endpoint?: string): number | undefined {
    const state = this.state.get(this.getKey(source, endpoint));
    if (!state?.resetAt || state.remaining === undefined || state.remaining <= 0) {
      return undefined;
    }
    const msUntilReset = state.resetAt.getTime() - Date.now();
    return msUntilReset > 0 ? msUntilReset / state.remaining : undefined;
  }

  async waitForCapacity(source: string, endpoint?: string): Promise<void> {
    const config = this.getConfig(source);
    const key = this.getKey(source, endpoint);

    // Check if we can proceed immediately
    if (await this.canProceed(source, endpoint)) {
      // In throttle mode, hold the caller until its reserved slot comes up
      if (config.strategy === 'throttle') {
        const delay = this.reserveSlot(source, endpoint);
        if (delay > 0) {
          await sleep(delay);
        }
      }
      return;
    }

    // We're rate limited
    const state = this.state.get(key);
    const now = Date.now();

    // Calculate wait time
    let waitUntil: Date;
    const laneBackoff = this.laneBackoff.get(source);
    if (laneBackoff && laneBackoff.getTime() > now) {
      waitUntil = laneBackoff;
    } else if (state?.retryAfter) {
      waitUntil = state.retryAfter;
    } else if (state?.resetAt) {
      waitUntil = state.resetAt;
    } else {
      // No reset info, use fallback
      waitUntil = new Date(now + 60000);
    }

    const totalWaitMs = waitUntil.getTime() - now;
    const totalWaitSeconds = Math.ceil(totalWaitMs / 1000);

    // Check strategy
    if (config.strategy === 'fail') {
      throw new RateLimitError(source, state?.resetAt);
    }

    // Check if wait exceeds max
    if (totalWaitSeconds > config.maxWait) {
      throw new RateLimitTimeoutError(source, 0, config.maxWait);
    }

    // Emit rate limited event
    const event: RateLimitEvent = {
      source,
      endpoint,
      waitSeconds: totalWaitSeconds,
      remaining: state?.remaining,
      resetAt: state?.resetAt,
      strategy: config.strategy,
    };
    this.callbacks.onRateLimited?.(event);

    // Wait with periodic updates
    const startTime = Date.now();
    let lastNotify = 0;

    while (!(await this.canProceed(source, endpoint))) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      // Check timeout
      if (elapsed >= config.maxWait) {
        throw new RateLimitTimeoutError(source, elapsed, config.maxWait);
      }

      // Periodic notification
      if (elapsed >= config.notifyAt && elapsed - lastNotify >= 10) {
        lastNotify = elapsed;
        this.callbacks.onWaiting?.({
          ...event,
          elapsedSeconds: elapsed,
          waitSeconds: Math.max(0, totalWaitSeconds - elapsed),
        });
      }

      // Sleep in chunks (check every 1-5 seconds)
      const remainingMs = waitUntil.getTime() - Date.now();
      const sleepMs = Math.min(Math.max(remainingMs, 1000), 5000);
      await sleep(sleepMs);
    }

    // Emit resumed event
    const waitedSeconds = Math.floor((Date.now() - startTime) / 1000);
    this.callbacks.onResumed?.({ source, endpoint, waitedSeconds });
  }

  /**
   * How long a request issued right now would be held for, in ms.
   *
   * Read-only: it reports the pacing waitForCapacity would apply without
   * claiming the slot, so callers can inspect the throttle without perturbing
   * it. Actual pacing comes from the lane reservation in waitForCapacity.
   */
  getThrottleDelay(source: string, endpoint?: string): number {
    const config = this.getConfig(source);
    if (config.strategy !== 'throttle') return 0;

    const model = this.getModel(source);
    if (model) return Math.round(model.peek(source, Date.now()));

    const now = Date.now();
    const untilNextSlot = Math.max(0, (this.pacing.get(source) ?? 0) - now);
    return Math.round(Math.max(untilNextSlot, this.headerIntervalMs(source, endpoint) ?? 0));
  }

  recordResponse(source: string, info: RateLimitInfo, endpoint?: string): void {
    const key = this.getKey(source, endpoint);
    const now = new Date();

    const state: RateLimitState = this.state.get(key) ?? {};

    if (info.remaining !== undefined) {
      state.remaining = info.remaining;
    }

    if (info.limit !== undefined) {
      state.limit = info.limit;
    }

    if (info.resetAt) {
      state.resetAt = info.resetAt;
    }

    if (info.retryAfter !== undefined) {
      const until = new Date(now.getTime() + info.retryAfter * 1000);
      state.retryAfter = until;
      this.laneBackoff.set(source, until);
      // Push the lane's send slot past the backoff so callers already queued on
      // the throttle don't stampede the moment it lifts.
      this.pacing.set(source, Math.max(this.pacing.get(source) ?? 0, until.getTime()));
    }

    state.lastRequestAt = now;

    this.state.set(key, state);

    // Trigger a stale-entry sweep every N responses. The sweep itself is rate-
    // limited by CLEANUP_INTERVAL_MS / MAX_ENTRIES_BEFORE_CLEANUP inside
    // cleanup(), so this counter only decides how often we *consider* sweeping.
    //
    // Proactive pacing (when a source declares a `model`) is handled by the
    // token-bucket reservation in reserveSlot, which accounts for issued-but-
    // unreturned requests by advancing the schedule synchronously. This header
    // path stays as the reactive safety net: a 429 still backs the lane off even
    // if the model underestimated. A natural next step is to let an observed 429
    // tighten the model's effective rate (auto-calibration).
    this.responsesSinceCleanup++;
    if (this.responsesSinceCleanup >= RATE_LIMIT_DEFAULTS.CLEANUP_CHECK_INTERVAL) {
      this.responsesSinceCleanup = 0;
      this.cleanup();
    }
  }

  getStatus(source: string, endpoint?: string): RateLimitStatus {
    const key = this.getKey(source, endpoint);
    const state = this.state.get(key);
    const now = new Date();

    if (!state) {
      return { isLimited: false };
    }

    const isLimited =
      (state.retryAfter && state.retryAfter > now) ||
      (state.remaining !== undefined &&
        state.remaining <= 0 &&
        state.resetAt &&
        state.resetAt > now);

    let resetInSeconds: number | undefined;
    if (isLimited && state.resetAt) {
      resetInSeconds = Math.ceil((state.resetAt.getTime() - now.getTime()) / 1000);
    } else if (isLimited && state.retryAfter) {
      resetInSeconds = Math.ceil((state.retryAfter.getTime() - now.getTime()) / 1000);
    }

    return {
      remaining: state.remaining,
      limit: state.limit,
      resetAt: state.resetAt,
      isLimited: Boolean(isLimited),
      resetInSeconds,
    };
  }
}

/**
 * Parse rate limit info from HTTP response headers
 *
 * Supports common header patterns:
 * - X-RateLimit-Remaining, X-RateLimit-Limit, X-RateLimit-Reset
 * - RateLimit-Remaining, RateLimit-Limit, RateLimit-Reset
 * - X-Rate-Limit-Remaining, etc.
 * - Retry-After (from 429 responses)
 */
export function parseRateLimitHeaders(headers: Record<string, string>): RateLimitInfo {
  const info: RateLimitInfo = {};

  // Normalize headers to lowercase for matching
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  // Parse remaining
  const remainingKey = findHeader(normalized, [
    'x-ratelimit-remaining',
    'ratelimit-remaining',
    'x-rate-limit-remaining',
  ]);
  if (remainingKey) {
    info.remaining = parseInt(normalized[remainingKey], 10);
  }

  // Parse limit
  const limitKey = findHeader(normalized, [
    'x-ratelimit-limit',
    'ratelimit-limit',
    'x-rate-limit-limit',
  ]);
  if (limitKey) {
    info.limit = parseInt(normalized[limitKey], 10);
  }

  // Parse reset
  const resetKey = findHeader(normalized, [
    'x-ratelimit-reset',
    'ratelimit-reset',
    'x-rate-limit-reset',
  ]);
  if (resetKey) {
    const resetValue = normalized[resetKey];
    // Could be Unix timestamp or ISO date
    const asNumber = parseInt(resetValue, 10);
    if (!isNaN(asNumber)) {
      // Unix timestamp (seconds)
      if (asNumber > 1000000000000) {
        // Already in milliseconds
        info.resetAt = new Date(asNumber);
      } else {
        // In seconds
        info.resetAt = new Date(asNumber * 1000);
      }
    } else {
      // Try as date string
      const parsed = new Date(resetValue);
      if (!isNaN(parsed.getTime())) {
        info.resetAt = parsed;
      }
    }
  }

  // Parse Retry-After (usually from 429 responses)
  const retryAfter = normalized['retry-after'];
  if (retryAfter) {
    const asNumber = parseInt(retryAfter, 10);
    if (!isNaN(asNumber)) {
      info.retryAfter = asNumber;
    } else {
      // HTTP-date format
      const parsed = new Date(retryAfter);
      if (!isNaN(parsed.getTime())) {
        info.retryAfter = Math.ceil((parsed.getTime() - Date.now()) / 1000);
      }
    }
  }

  return info;
}

function findHeader(headers: Record<string, string>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate in headers) {
      return candidate;
    }
  }
  return undefined;
}
