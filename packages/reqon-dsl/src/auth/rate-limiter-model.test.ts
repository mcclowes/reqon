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

/**
 * FPL's limiter (OpenResty) sends no Retry-After. A headerless 429 must still
 * back the lane off and tighten the model, or the client keeps hammering the
 * exact rate that just failed.
 */
describe('AdaptiveRateLimiter reacting to headerless 429s', () => {
  beforeEach(() => {
    sleeps.length = 0;
  });

  it('backs a lane off on a 429 with no Retry-After', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', { strategy: 'throttle', fallbackRpm: 60000 }); // ~fast

    // A 429 with no retryAfter still blocks the lane for the floor cool-off.
    limiter.recordResponse('api', { rejected: true });
    expect(await limiter.canProceed('api')).toBe(false);
  });

  it('does nothing on a plain success (no false backoff)', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', { strategy: 'throttle', fallbackRpm: 60000 });

    limiter.recordResponse('api', { remaining: 5 }); // 2xx, not rejected
    expect(await limiter.canProceed('api')).toBe(true);
  });

  it('drains the modeled burst on a 429, so the lane paces sooner', async () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.configure('api', {
      strategy: 'throttle',
      model: { type: 'tokenBucket', capacity: 3, refill: 100 }, // normally 3 free
    });

    // A rejection drains the burst via penalize (no fixed cool-off on a model
    // lane), so only the one just-refilled token is free instead of 3.
    limiter.recordResponse('api', { rejected: true });
    await limiter.waitForCapacity('api'); // free
    await limiter.waitForCapacity('api'); // must pace
    expect(sleeps.length).toBe(1);
  });

  it('calibrates per proxy lane, not across the pool', async () => {
    const limiter = new AdaptiveRateLimiter();
    // No model here: the headerless cool-off is the observable backoff.
    limiter.configure('api', { strategy: 'throttle', fallbackRpm: 60000 });

    limiter.recordResponse('api@proxy-a', { rejected: true });
    // Lane A is now backed off; lane B, which never 429'd, is clear.
    expect(await limiter.canProceed('api@proxy-a')).toBe(false);
    expect(await limiter.canProceed('api@proxy-b')).toBe(true);
  });
});
