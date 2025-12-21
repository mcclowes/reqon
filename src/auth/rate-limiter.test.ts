import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdaptiveRateLimiter,
  parseRateLimitHeaders,
  RateLimitTimeoutError,
  RateLimitError,
} from './rate-limiter.js';
import type { RateLimitCallbacks, RateLimitConfig } from './types.js';

describe('AdaptiveRateLimiter', () => {
  let limiter: AdaptiveRateLimiter;

  beforeEach(() => {
    limiter = new AdaptiveRateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('canProceed', () => {
    it('returns true when no rate limit state exists', async () => {
      const result = await limiter.canProceed('api');
      expect(result).toBe(true);
    });

    it('returns true when remaining quota is positive', async () => {
      limiter.recordResponse('api', { remaining: 50, limit: 100 });
      const result = await limiter.canProceed('api');
      expect(result).toBe(true);
    });

    it('returns false when remaining quota is zero', async () => {
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });
      const result = await limiter.canProceed('api');
      expect(result).toBe(false);
    });

    it('returns false when retry-after is in the future', async () => {
      limiter.recordResponse('api', { retryAfter: 30 });
      const result = await limiter.canProceed('api');
      expect(result).toBe(false);
    });

    it('returns true when reset time has passed', async () => {
      const resetAt = new Date(Date.now() - 1000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });
      const result = await limiter.canProceed('api');
      expect(result).toBe(true);
    });

    it('tracks endpoints separately', async () => {
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt }, '/endpoint1');
      limiter.recordResponse('api', { remaining: 50, limit: 100 }, '/endpoint2');

      expect(await limiter.canProceed('api', '/endpoint1')).toBe(false);
      expect(await limiter.canProceed('api', '/endpoint2')).toBe(true);
    });
  });

  describe('recordResponse', () => {
    it('records remaining quota', () => {
      limiter.recordResponse('api', { remaining: 75, limit: 100 });
      const status = limiter.getStatus('api');
      expect(status.remaining).toBe(75);
      expect(status.limit).toBe(100);
    });

    it('records reset time', () => {
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('api', { resetAt });
      const status = limiter.getStatus('api');
      expect(status.resetAt).toEqual(resetAt);
    });

    it('records retry-after as future date', () => {
      const now = Date.now();
      limiter.recordResponse('api', { retryAfter: 30 });
      const status = limiter.getStatus('api');
      expect(status.isLimited).toBe(true);
    });

    it('updates existing state', () => {
      limiter.recordResponse('api', { remaining: 100, limit: 100 });
      limiter.recordResponse('api', { remaining: 50, limit: 100 });
      const status = limiter.getStatus('api');
      expect(status.remaining).toBe(50);
    });

    it('tracks per-endpoint state', () => {
      limiter.recordResponse('api', { remaining: 10 }, '/users');
      limiter.recordResponse('api', { remaining: 90 }, '/posts');

      expect(limiter.getStatus('api', '/users').remaining).toBe(10);
      expect(limiter.getStatus('api', '/posts').remaining).toBe(90);
    });
  });

  describe('getStatus', () => {
    it('returns isLimited false when no state', () => {
      const status = limiter.getStatus('unknown');
      expect(status.isLimited).toBe(false);
    });

    it('returns isLimited true when remaining is 0', () => {
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });
      const status = limiter.getStatus('api');
      expect(status.isLimited).toBe(true);
    });

    it('calculates resetInSeconds', () => {
      const resetAt = new Date(Date.now() + 30000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });
      const status = limiter.getStatus('api');
      expect(status.resetInSeconds).toBeGreaterThan(25);
      expect(status.resetInSeconds).toBeLessThanOrEqual(30);
    });
  });

  describe('waitForCapacity', () => {
    it('returns immediately when not rate limited', async () => {
      limiter.recordResponse('api', { remaining: 50, limit: 100 });
      await limiter.waitForCapacity('api');
      // Should resolve without waiting
    });

    it('throws RateLimitError when strategy is fail', async () => {
      limiter.configure('api', { strategy: 'fail' });
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });

      await expect(limiter.waitForCapacity('api')).rejects.toThrow(RateLimitError);
    });

    it('throws RateLimitTimeoutError when wait exceeds maxWait', async () => {
      limiter.configure('api', { strategy: 'pause', maxWait: 5 });
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });

      await expect(limiter.waitForCapacity('api')).rejects.toThrow(RateLimitTimeoutError);
    });

    it('waits for capacity with pause strategy', async () => {
      limiter.configure('api', { strategy: 'pause', maxWait: 120 });
      const resetAt = new Date(Date.now() + 5000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });

      const promise = limiter.waitForCapacity('api');

      // Advance time past reset
      vi.advanceTimersByTime(6000);

      await promise;
      // Should resolve after waiting
    });

    it('emits onRateLimited callback', async () => {
      const onRateLimited = vi.fn();
      limiter.setCallbacks({ onRateLimited });
      limiter.configure('api', { strategy: 'pause', maxWait: 120 });

      const resetAt = new Date(Date.now() + 10000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });

      const promise = limiter.waitForCapacity('api');

      // Allow the async canProceed to complete
      await vi.advanceTimersByTimeAsync(0);

      // The callback should be called after canProceed returns false
      expect(onRateLimited).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'api',
          strategy: 'pause',
        })
      );

      await vi.advanceTimersByTimeAsync(15000);
      await promise;
    });

    it('emits onResumed callback after waiting', async () => {
      const onResumed = vi.fn();
      limiter.setCallbacks({ onResumed });
      limiter.configure('api', { strategy: 'pause', maxWait: 120 });

      const resetAt = new Date(Date.now() + 3000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });

      const promise = limiter.waitForCapacity('api');
      vi.advanceTimersByTime(5000);
      await promise;

      expect(onResumed).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'api',
        })
      );
    });

    it('emits periodic onWaiting callbacks', async () => {
      const onWaiting = vi.fn();
      limiter.setCallbacks({ onWaiting });
      limiter.configure('api', { strategy: 'pause', maxWait: 120, notifyAt: 5 });

      const resetAt = new Date(Date.now() + 30000);
      limiter.recordResponse('api', { remaining: 0, limit: 100, resetAt });

      const promise = limiter.waitForCapacity('api');

      // Advance past notifyAt threshold - use async version to let promises resolve
      await vi.advanceTimersByTimeAsync(10000);

      // Should have called onWaiting
      expect(onWaiting).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(25000);
      await promise;
    });
  });

  describe('getThrottleDelay', () => {
    it('returns 0 when strategy is not throttle', () => {
      limiter.configure('api', { strategy: 'pause' });
      limiter.recordResponse('api', { remaining: 10, limit: 100 });
      expect(limiter.getThrottleDelay('api')).toBe(0);
    });

    it('returns 0 when no state exists', () => {
      limiter.configure('api', { strategy: 'throttle' });
      expect(limiter.getThrottleDelay('unknown')).toBe(0);
    });

    it('calculates delay based on remaining quota and reset time', () => {
      limiter.configure('api', { strategy: 'throttle' });
      const resetAt = new Date(Date.now() + 60000); // 60 seconds
      limiter.recordResponse('api', { remaining: 10, limit: 100, resetAt });

      const delay = limiter.getThrottleDelay('api');
      // With 10 remaining in 60 seconds, optimal is ~6000ms per request
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(60000);
    });

    it('uses fallback RPM when no rate limit info', () => {
      limiter.configure('api', { strategy: 'throttle', fallbackRpm: 60 });
      limiter.recordResponse('api', {});

      // With 60 RPM, delay should be ~1000ms
      const delay = limiter.getThrottleDelay('api');
      expect(delay).toBeLessThanOrEqual(1000);
    });
  });

  describe('configure', () => {
    it('allows per-source configuration', async () => {
      limiter.configure('api1', { strategy: 'fail' });
      limiter.configure('api2', { strategy: 'pause', maxWait: 60 });

      const resetAt = new Date(Date.now() + 30000);
      limiter.recordResponse('api1', { remaining: 0, resetAt });
      limiter.recordResponse('api2', { remaining: 0, resetAt });

      await expect(limiter.waitForCapacity('api1')).rejects.toThrow(RateLimitError);
      // api2 would wait (not throw immediately)
    });
  });

  describe('cleanup', () => {
    it('tracks endpoint count', () => {
      limiter.recordResponse('api1', { remaining: 50 });
      limiter.recordResponse('api2', { remaining: 50 });
      limiter.recordResponse('api3', { remaining: 50 }, '/endpoint');

      expect(limiter.getTrackedEndpointCount()).toBe(3);
    });

    it('clears stale entries on forceCleanup', () => {
      // Add some state
      const oldReset = new Date(Date.now() - 3600001); // Over 1 hour ago
      limiter.recordResponse('stale', { remaining: 0, resetAt: oldReset });

      // Manually set lastRequestAt to be old
      const limiterAny = limiter as unknown as {
        state: Map<string, { lastRequestAt: Date }>;
      };
      limiterAny.state.get('stale')!.lastRequestAt = new Date(Date.now() - 3600001);

      limiter.forceCleanup();

      expect(limiter.getTrackedEndpointCount()).toBe(0);
    });
  });

  describe('default configuration', () => {
    it('uses pause strategy by default', async () => {
      // Not configured, should use defaults
      const resetAt = new Date(Date.now() + 400000); // More than default maxWait
      limiter.recordResponse('api', { remaining: 0, resetAt });

      // Should throw timeout error (default maxWait is 300s)
      await expect(limiter.waitForCapacity('api')).rejects.toThrow(RateLimitTimeoutError);
    });

    it('accepts default config in constructor', async () => {
      const customLimiter = new AdaptiveRateLimiter({ strategy: 'fail' });
      const resetAt = new Date(Date.now() + 60000);
      customLimiter.recordResponse('api', { remaining: 0, resetAt });

      await expect(customLimiter.waitForCapacity('api')).rejects.toThrow(RateLimitError);
    });
  });
});

describe('parseRateLimitHeaders', () => {
  it('parses X-RateLimit-* headers', () => {
    const headers = {
      'X-RateLimit-Remaining': '50',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.remaining).toBe(50);
    expect(info.limit).toBe(100);
    expect(info.resetAt).toBeInstanceOf(Date);
  });

  it('parses RateLimit-* headers (without X-)', () => {
    const headers = {
      'RateLimit-Remaining': '25',
      'RateLimit-Limit': '50',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.remaining).toBe(25);
    expect(info.limit).toBe(50);
  });

  it('parses X-Rate-Limit-* headers (with hyphen)', () => {
    const headers = {
      'X-Rate-Limit-Remaining': '10',
      'X-Rate-Limit-Limit': '100',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.remaining).toBe(10);
    expect(info.limit).toBe(100);
  });

  it('parses Retry-After header in seconds', () => {
    const headers = {
      'Retry-After': '30',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.retryAfter).toBe(30);
  });

  it('parses Retry-After header as HTTP date', () => {
    const futureDate = new Date(Date.now() + 60000);
    const headers = {
      'Retry-After': futureDate.toUTCString(),
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.retryAfter).toBeGreaterThan(0);
    expect(info.retryAfter).toBeLessThanOrEqual(60);
  });

  it('handles reset as millisecond timestamp', () => {
    const resetMs = Date.now() + 60000;
    const headers = {
      'X-RateLimit-Reset': String(resetMs),
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.resetAt?.getTime()).toBeCloseTo(resetMs, -2);
  });

  it('handles reset as second timestamp', () => {
    const resetSec = Math.floor(Date.now() / 1000) + 60;
    const headers = {
      'X-RateLimit-Reset': String(resetSec),
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.resetAt?.getTime()).toBeCloseTo(resetSec * 1000, -2);
  });

  it('handles case-insensitive headers', () => {
    const headers = {
      'x-ratelimit-remaining': '42',
      'X-RATELIMIT-LIMIT': '100',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.remaining).toBe(42);
    expect(info.limit).toBe(100);
  });

  it('returns empty object for no recognized headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Custom-Header': 'value',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info).toEqual({});
  });

  it('handles ISO date string for reset', () => {
    const resetDate = new Date(Date.now() + 60000).toISOString();
    const headers = {
      'X-RateLimit-Reset': resetDate,
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.resetAt).toBeInstanceOf(Date);
  });
});

describe('RateLimitTimeoutError', () => {
  it('contains source and timing info', () => {
    const error = new RateLimitTimeoutError('api', 30, 60);

    expect(error.source).toBe('api');
    expect(error.waitedSeconds).toBe(30);
    expect(error.maxWait).toBe(60);
    expect(error.message).toContain('api');
    expect(error.message).toContain('30');
    expect(error.message).toContain('60');
  });
});

describe('RateLimitError', () => {
  it('contains source info', () => {
    const error = new RateLimitError('api');

    expect(error.source).toBe('api');
    expect(error.message).toContain('api');
  });

  it('includes reset time in message when provided', () => {
    const resetAt = new Date(Date.now() + 30000);
    const error = new RateLimitError('api', resetAt);

    expect(error.resetAt).toEqual(resetAt);
    expect(error.message).toContain('resets in');
  });
});
