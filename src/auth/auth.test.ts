import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AdaptiveRateLimiter,
  parseRateLimitHeaders,
  RateLimitError,
  RateLimitTimeoutError,
} from './rate-limiter.js';
import { InMemoryTokenStore } from './token-store.js';
import type { OAuth2Tokens, RateLimitEvent } from './types.js';

describe('parseRateLimitHeaders', () => {
  it('parses X-RateLimit headers', () => {
    const headers = {
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '42',
      'X-RateLimit-Reset': '1700000000',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.limit).toBe(100);
    expect(info.remaining).toBe(42);
    expect(info.resetAt).toBeInstanceOf(Date);
    expect(info.resetAt?.getTime()).toBe(1700000000 * 1000);
  });

  it('parses lowercase ratelimit headers', () => {
    const headers = {
      'ratelimit-limit': '60',
      'ratelimit-remaining': '5',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.limit).toBe(60);
    expect(info.remaining).toBe(5);
  });

  it('parses Retry-After header (seconds)', () => {
    const headers = {
      'Retry-After': '30',
    };

    const info = parseRateLimitHeaders(headers);

    expect(info.retryAfter).toBe(30);
  });

  it('handles missing headers gracefully', () => {
    const info = parseRateLimitHeaders({});

    expect(info.limit).toBeUndefined();
    expect(info.remaining).toBeUndefined();
    expect(info.resetAt).toBeUndefined();
    expect(info.retryAfter).toBeUndefined();
  });
});

describe('AdaptiveRateLimiter', () => {
  let limiter: AdaptiveRateLimiter;

  beforeEach(() => {
    limiter = new AdaptiveRateLimiter();
  });

  it('allows requests when no limits recorded', async () => {
    const canProceed = await limiter.canProceed('TestAPI');
    expect(canProceed).toBe(true);
  });

  it('blocks requests when remaining is 0', async () => {
    const futureReset = new Date(Date.now() + 60000);
    limiter.recordResponse('TestAPI', {
      remaining: 0,
      limit: 100,
      resetAt: futureReset,
    });

    const canProceed = await limiter.canProceed('TestAPI');
    expect(canProceed).toBe(false);
  });

  it('allows requests after reset time passes', async () => {
    const pastReset = new Date(Date.now() - 1000);
    limiter.recordResponse('TestAPI', {
      remaining: 0,
      limit: 100,
      resetAt: pastReset,
    });

    const canProceed = await limiter.canProceed('TestAPI');
    expect(canProceed).toBe(true);
  });

  it('blocks during retry-after period', async () => {
    limiter.recordResponse('TestAPI', {
      retryAfter: 60, // 60 seconds
    });

    const canProceed = await limiter.canProceed('TestAPI');
    expect(canProceed).toBe(false);
  });

  it('tracks limits per source', async () => {
    limiter.recordResponse('API1', { remaining: 0, resetAt: new Date(Date.now() + 60000) });
    limiter.recordResponse('API2', { remaining: 50, limit: 100 });

    expect(await limiter.canProceed('API1')).toBe(false);
    expect(await limiter.canProceed('API2')).toBe(true);
  });

  it('tracks limits per endpoint within source', async () => {
    limiter.recordResponse('API', { remaining: 0, resetAt: new Date(Date.now() + 60000) }, '/invoices');
    limiter.recordResponse('API', { remaining: 50, limit: 100 }, '/contacts');

    expect(await limiter.canProceed('API', '/invoices')).toBe(false);
    expect(await limiter.canProceed('API', '/contacts')).toBe(true);
  });

  it('provides accurate status', () => {
    limiter.recordResponse('TestAPI', {
      remaining: 42,
      limit: 100,
      resetAt: new Date(Date.now() + 60000),
    });

    const status = limiter.getStatus('TestAPI');

    expect(status.remaining).toBe(42);
    expect(status.limit).toBe(100);
    expect(status.isLimited).toBe(false);
  });

  describe('fail strategy', () => {
    it('throws RateLimitError immediately when rate limited', async () => {
      limiter.configure('FailAPI', { strategy: 'fail' });
      limiter.recordResponse('FailAPI', {
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
      });

      await expect(limiter.waitForCapacity('FailAPI')).rejects.toThrow(RateLimitError);
    });

    it('includes reset time in error', async () => {
      limiter.configure('FailAPI', { strategy: 'fail' });
      const resetAt = new Date(Date.now() + 60000);
      limiter.recordResponse('FailAPI', { remaining: 0, resetAt });

      try {
        await limiter.waitForCapacity('FailAPI');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).resetAt).toEqual(resetAt);
      }
    });
  });

  describe('pause strategy', () => {
    it('throws RateLimitTimeoutError when maxWait exceeded', async () => {
      limiter.configure('PauseAPI', { strategy: 'pause', maxWait: 1 });
      limiter.recordResponse('PauseAPI', {
        remaining: 0,
        resetAt: new Date(Date.now() + 60000), // 60s in future
      });

      await expect(limiter.waitForCapacity('PauseAPI')).rejects.toThrow(RateLimitTimeoutError);
    });

    it('proceeds after reset time passes', async () => {
      limiter.configure('PauseAPI', { strategy: 'pause', maxWait: 5 });
      // Reset in 50ms
      limiter.recordResponse('PauseAPI', {
        remaining: 0,
        resetAt: new Date(Date.now() + 50),
      });

      // Should complete without throwing
      await limiter.waitForCapacity('PauseAPI');
    });
  });

  describe('throttle strategy', () => {
    it('calculates delay based on remaining requests and reset time', () => {
      limiter.configure('ThrottleAPI', { strategy: 'throttle' });
      limiter.recordResponse('ThrottleAPI', {
        remaining: 10,
        limit: 100,
        resetAt: new Date(Date.now() + 10000), // 10s left
      });

      const delay = limiter.getThrottleDelay('ThrottleAPI');
      // 10s / 10 remaining = 1s per request = 1000ms
      expect(delay).toBeGreaterThanOrEqual(900);
      expect(delay).toBeLessThanOrEqual(1100);
    });

    it('returns 0 delay when not in throttle mode', () => {
      limiter.configure('PauseAPI', { strategy: 'pause' });
      limiter.recordResponse('PauseAPI', { remaining: 10, limit: 100 });

      const delay = limiter.getThrottleDelay('PauseAPI');
      expect(delay).toBe(0);
    });

    it('uses fallback RPM when no rate limit headers', () => {
      limiter.configure('FallbackAPI', { strategy: 'throttle', fallbackRpm: 60 });
      limiter.recordResponse('FallbackAPI', {}); // No rate limit info

      const delay = limiter.getThrottleDelay('FallbackAPI');
      // 60 RPM = 1 per second = 1000ms intervals
      expect(delay).toBeLessThanOrEqual(1000);
    });
  });

  describe('callbacks', () => {
    it('calls onRateLimited when rate limited', async () => {
      const onRateLimited = vi.fn();
      limiter.setCallbacks({ onRateLimited });
      // Use maxWait of 10s so it doesn't timeout immediately (wait is only 50ms)
      limiter.configure('CallbackAPI', { strategy: 'pause', maxWait: 10 });
      limiter.recordResponse('CallbackAPI', {
        remaining: 0,
        resetAt: new Date(Date.now() + 50), // Resets in 50ms
      });

      await limiter.waitForCapacity('CallbackAPI');

      expect(onRateLimited).toHaveBeenCalledTimes(1);
      expect(onRateLimited).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'CallbackAPI',
          strategy: 'pause',
        })
      );
    });

    it('calls onResumed after waiting completes', async () => {
      const onResumed = vi.fn();
      limiter.setCallbacks({ onResumed });
      limiter.configure('ResumeAPI', { strategy: 'pause', maxWait: 5 });
      // Reset in 50ms
      limiter.recordResponse('ResumeAPI', {
        remaining: 0,
        resetAt: new Date(Date.now() + 50),
      });

      await limiter.waitForCapacity('ResumeAPI');

      expect(onResumed).toHaveBeenCalledTimes(1);
      expect(onResumed).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ResumeAPI',
        })
      );
    });
  });
});

describe('InMemoryTokenStore', () => {
  let store: InMemoryTokenStore;

  beforeEach(() => {
    store = new InMemoryTokenStore();
  });

  it('stores and retrieves tokens', async () => {
    const tokens: OAuth2Tokens = {
      accessToken: 'access123',
      refreshToken: 'refresh456',
      expiresAt: new Date(Date.now() + 3600000),
    };

    await store.set('connection-1', tokens);
    const retrieved = await store.get('connection-1');

    expect(retrieved?.accessToken).toBe('access123');
    expect(retrieved?.refreshToken).toBe('refresh456');
  });

  it('returns null for unknown connections', async () => {
    const result = await store.get('unknown');
    expect(result).toBeNull();
  });

  it('deletes tokens', async () => {
    await store.set('connection-1', { accessToken: 'test' });
    await store.delete('connection-1');

    const result = await store.get('connection-1');
    expect(result).toBeNull();
  });

  it('lists all connections', async () => {
    await store.set('conn-1', { accessToken: 'a' });
    await store.set('conn-2', { accessToken: 'b' });
    await store.set('conn-3', { accessToken: 'c' });

    const connections = await store.list();

    expect(connections).toHaveLength(3);
    expect(connections).toContain('conn-1');
    expect(connections).toContain('conn-2');
    expect(connections).toContain('conn-3');
  });

  it('identifies tokens needing refresh', async () => {
    // Token expiring in 10 seconds (within 5 min buffer)
    await store.set('expiring-soon', {
      accessToken: 'test',
      expiresAt: new Date(Date.now() + 10000),
    });

    // Token not expiring soon
    await store.set('valid', {
      accessToken: 'test',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const needsRefresh = await store.getTokensNeedingRefresh(300);

    expect(needsRefresh).toContain('expiring-soon');
    expect(needsRefresh).not.toContain('valid');
  });
});
