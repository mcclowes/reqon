import type {
  RateLimiter,
  RateLimitInfo,
  RateLimitStatus,
  RateLimitConfig,
  RateLimitCallbacks,
  RateLimitEvent,
} from './types.js';

interface RateLimitState {
  remaining?: number;
  limit?: number;
  resetAt?: Date;
  retryAfter?: Date;
  lastRequestAt?: Date;
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  strategy: 'pause',
  maxWait: 300,
  notifyAt: 10,
  fallbackRpm: 60,
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
  private configs: Map<string, RateLimitConfig> = new Map();
  private callbacks: RateLimitCallbacks = {};

  constructor(private defaultConfig: Partial<RateLimitConfig> = {}) {}

  private getKey(source: string, endpoint?: string): string {
    return endpoint ? `${source}:${endpoint}` : source;
  }

  private getConfig(source: string): Required<RateLimitConfig> {
    const sourceConfig = this.configs.get(source) ?? {};
    return { ...DEFAULT_CONFIG, ...this.defaultConfig, ...sourceConfig };
  }

  configure(source: string, config: RateLimitConfig): void {
    this.configs.set(source, config);
  }

  setCallbacks(callbacks: RateLimitCallbacks): void {
    this.callbacks = callbacks;
  }

  async canProceed(source: string, endpoint?: string): Promise<boolean> {
    const key = this.getKey(source, endpoint);
    const state = this.state.get(key);

    if (!state) return true;

    const now = new Date();

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

  async waitForCapacity(source: string, endpoint?: string): Promise<void> {
    const config = this.getConfig(source);
    const key = this.getKey(source, endpoint);

    // Check if we can proceed immediately
    if (await this.canProceed(source, endpoint)) {
      // In throttle mode, add delay between requests
      if (config.strategy === 'throttle') {
        const delay = this.getThrottleDelay(source, endpoint);
        if (delay > 0) {
          await this.sleep(delay);
        }
      }
      return;
    }

    // We're rate limited
    const state = this.state.get(key);
    const now = Date.now();

    // Calculate wait time
    let waitUntil: Date;
    if (state?.retryAfter) {
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
      await this.sleep(sleepMs);
    }

    // Emit resumed event
    const waitedSeconds = Math.floor((Date.now() - startTime) / 1000);
    this.callbacks.onResumed?.({ source, endpoint, waitedSeconds });
  }

  getThrottleDelay(source: string, endpoint?: string): number {
    const key = this.getKey(source, endpoint);
    const state = this.state.get(key);
    const config = this.getConfig(source);

    if (config.strategy !== 'throttle') return 0;
    if (!state) return 0;

    const now = Date.now();

    // If we have remaining count and reset time, calculate optimal spacing
    if (
      state.remaining !== undefined &&
      state.remaining > 0 &&
      state.resetAt &&
      state.resetAt.getTime() > now
    ) {
      const msUntilReset = state.resetAt.getTime() - now;
      // Space requests evenly across remaining time
      const optimalInterval = msUntilReset / state.remaining;

      // Check time since last request
      if (state.lastRequestAt) {
        const msSinceLastRequest = now - state.lastRequestAt.getTime();
        const delay = Math.max(0, optimalInterval - msSinceLastRequest);
        return Math.round(delay);
      }

      return Math.round(optimalInterval);
    }

    // Fallback: use configured RPM
    const intervalMs = 60000 / config.fallbackRpm;
    if (state.lastRequestAt) {
      const msSinceLastRequest = now - state.lastRequestAt.getTime();
      return Math.max(0, Math.round(intervalMs - msSinceLastRequest));
    }

    return 0;
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
      state.retryAfter = new Date(now.getTime() + info.retryAfter * 1000);
    }

    state.lastRequestAt = now;

    this.state.set(key, state);
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
      (state.remaining !== undefined && state.remaining <= 0 && state.resetAt && state.resetAt > now);

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
