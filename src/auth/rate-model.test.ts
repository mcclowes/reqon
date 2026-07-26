import { describe, it, expect } from 'vitest';
import { TokenBucketModel } from './rate-model.js';

/**
 * The model simulates the server's token bucket locally: a full bucket lets a
 * burst of `capacity` through at once, then the rate settles to `refill`/sec.
 * Reservations advance a per-key clock synchronously, so concurrent callers get
 * strictly spaced slots rather than all reading the same "now".
 */
describe('TokenBucketModel', () => {
  it('lets a full bucket burst up to capacity with no wait', () => {
    const m = new TokenBucketModel({ capacity: 5, refill: 10 });
    const now = 1_000_000;
    // First 5 (capacity) reservations are free.
    for (let i = 0; i < 5; i++) {
      expect(m.reserve('lane', now)).toBe(0);
    }
    // The 6th must wait ~one refill interval (1000/10 = 100ms).
    expect(m.reserve('lane', now)).toBeCloseTo(100, 5);
  });

  it('settles to the refill rate once the burst is spent', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 20 }); // no burst, T=50ms
    const now = 0;
    expect(m.reserve('k', now)).toBe(0);
    expect(m.reserve('k', now)).toBeCloseTo(50, 5);
    expect(m.reserve('k', now)).toBeCloseTo(100, 5);
  });

  it('refills over idle time', () => {
    const m = new TokenBucketModel({ capacity: 3, refill: 10 }); // T=100ms
    // Spend the whole bucket.
    for (let i = 0; i < 3; i++) m.reserve('k', 0);
    // After 300ms idle the bucket has refilled to capacity, so a burst is free again.
    for (let i = 0; i < 3; i++) {
      expect(m.reserve('k', 300)).toBe(0);
    }
  });

  it('never lets the modeled level exceed capacity even after a long idle', () => {
    const m = new TokenBucketModel({ capacity: 2, refill: 10 });
    for (let i = 0; i < 2; i++) m.reserve('k', 0);
    // A very long idle cannot bank more than `capacity` free requests.
    expect(m.reserve('k', 10_000_000)).toBe(0);
    expect(m.reserve('k', 10_000_000)).toBe(0);
    expect(m.reserve('k', 10_000_000)).toBeCloseTo(100, 5);
  });

  it('paces at safety * refill when a safety factor is set', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10, safety: 0.5 });
    // Effective refill 5/sec -> T = 200ms.
    m.reserve('k', 0);
    expect(m.reserve('k', 0)).toBeCloseTo(200, 5);
  });

  it('under-claims the burst by the safety factor', () => {
    // Server capacity 10, safety 0.8 -> the model bursts only 8 before pacing.
    const m = new TokenBucketModel({ capacity: 10, refill: 10, safety: 0.8 });
    const now = 0;
    let free = 0;
    for (let i = 0; i < 10; i++) {
      if (m.reserve('k', now) === 0) free++;
    }
    expect(free).toBe(8);
  });

  it('keeps separate buckets per lane', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10 });
    expect(m.reserve('a', 0)).toBe(0);
    expect(m.reserve('b', 0)).toBe(0); // b's bucket is untouched by a
    expect(m.reserve('a', 0)).toBeCloseTo(100, 5);
  });

  it('peek reports the wait without consuming a token', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10 });
    m.reserve('k', 0);
    expect(m.peek('k', 0)).toBeCloseTo(100, 5);
    expect(m.peek('k', 0)).toBeCloseTo(100, 5); // idempotent
    // The token is still there to be reserved.
    expect(m.reserve('k', 0)).toBeCloseTo(100, 5);
  });

  it('spaces concurrent callers that share one "now"', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10 }); // T=100ms
    const now = 5000;
    const waits = [0, 0, 0, 0].map(() => m.reserve('k', now));
    expect(waits).toEqual([0, 100, 200, 300]);
  });
});
