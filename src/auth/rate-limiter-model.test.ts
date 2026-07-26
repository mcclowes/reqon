import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the delays the limiter asks to sleep for, instead of actually waiting.
const sleeps: number[] = [];
vi.mock('../utils/async.js', () => ({
  sleep: (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  },
}));

import { AdaptiveRateLimiter } from './rate-limiter.js';

describe('AdaptiveRateLimiter with a token-bucket model', () => {
  beforeEach(() => {
    sleeps.length = 0;
  });

  it('bursts up to capacity, then paces at the refill rate', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', {
      strategy: 'throttle',
      model: { type: 'tokenBucket', capacity: 3, refill: 10 }, // T = 100ms
    });

    for (let i = 0; i < 6; i++) {
      await limiter.waitForCapacity('api');
    }

    // A sleep is only requested when the delay is > 0. First 3 (capacity) are
    // free; the next 3 pace at ~100ms each.
    expect(sleeps.length).toBe(3);
    for (const ms of sleeps) expect(ms).toBeGreaterThanOrEqual(90);
  });

  it('drives an independent bucket per proxy lane', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', {
      strategy: 'throttle',
      model: { type: 'tokenBucket', capacity: 1, refill: 100 },
    });

    // Two lanes off the same source config each get a full bucket, so the first
    // request on each is free.
    await limiter.waitForCapacity('api@proxy-a');
    await limiter.waitForCapacity('api@proxy-b');
    expect(sleeps.length).toBe(0);

    // The second request on lane A must wait; lane B is untouched.
    await limiter.waitForCapacity('api@proxy-a');
    expect(sleeps.length).toBe(1);
  });

  it('reports the modeled delay through getThrottleDelay', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', {
      strategy: 'throttle',
      model: { type: 'tokenBucket', capacity: 1, refill: 20 }, // T = 50ms
    });

    expect(limiter.getThrottleDelay('api')).toBe(0); // full bucket
    await limiter.waitForCapacity('api'); // spend the one token
    expect(limiter.getThrottleDelay('api')).toBeGreaterThanOrEqual(40);
  });

  it('falls back to fallbackRpm when no model is configured', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', { strategy: 'throttle', fallbackRpm: 600 }); // 100ms spacing

    await limiter.waitForCapacity('api'); // first slot is now
    await limiter.waitForCapacity('api'); // second waits ~100ms
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(90);
  });
});
