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

/**
 * The configured refill is a ceiling, not a measured truth. When the server
 * rejects a request anyway (a 429), the model slows that lane below the ceiling
 * and holds there until the rejections stop, then eases back up. This is the
 * only feedback loop available for a headerless limiter (no Retry-After).
 */
describe('TokenBucketModel adaptive calibration', () => {
  it('slows a lane after a 429 so the sustained interval widens', () => {
    // recoveryMs high so decay doesn't soften the interval within this window.
    const m = new TokenBucketModel({ capacity: 1, refill: 10, recoveryMs: 1e9 }); // base T=100ms
    m.reserve('k', 0); // spend the burst
    m.penalize('k', 0); // server says: too fast
    // Drive the clock the way the limiter does: advance by each returned wait.
    // rejectBackoff default 2 -> the steady interval doubles to 200ms.
    let clock = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 3; i++) {
      const wait = m.reserve('k', clock);
      const next = clock + wait;
      gaps.push(next - clock);
      clock = next;
    }
    // First returned wait is to the slot scheduled before the penalty; the
    // steady interval settles at 200ms thereafter.
    expect(gaps[1]).toBeCloseTo(200, 2);
    expect(gaps[2]).toBeCloseTo(200, 2);
  });

  it('compounds repeated rejections multiplicatively', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10 });
    expect(m.slowdownOf('k', 0)).toBe(1);
    m.penalize('k', 0);
    expect(m.slowdownOf('k', 0)).toBe(2);
    m.penalize('k', 0);
    expect(m.slowdownOf('k', 0)).toBe(4);
    m.penalize('k', 0);
    expect(m.slowdownOf('k', 0)).toBe(8);
  });

  it('caps the cumulative slowdown so a lane never stalls to zero', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10, maxSlowdown: 8 });
    for (let i = 0; i < 10; i++) m.penalize('k', 0);
    expect(m.slowdownOf('k', 0)).toBe(8);
  });

  it('drains the burst on a rejection', () => {
    const m = new TokenBucketModel({ capacity: 5, refill: 10 }); // 5 free normally
    m.penalize('k', 0);
    // Burst is gone: only the one just-refilled token is free, then it paces.
    // (Without the penalty a fresh lane fires all 5 at wait 0.)
    expect(m.reserve('k', 0)).toBe(0);
    expect(m.reserve('k', 0)).toBeGreaterThan(0);
  });

  it('decays the penalty back toward the ceiling over quiet time', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10, recoveryMs: 1000 });
    m.penalize('k', 0); // slowdown 2
    expect(m.slowdownOf('k', 0)).toBe(2);
    // After one time-constant the excess (1.0) has decayed by e^-1 ~= 0.368.
    expect(m.slowdownOf('k', 1000)).toBeCloseTo(1 + Math.exp(-1), 3);
    // After many constants it is effectively back at the ceiling.
    expect(m.slowdownOf('k', 20_000)).toBe(1);
  });

  it('keeps penalties per lane', () => {
    const m = new TokenBucketModel({ capacity: 1, refill: 10 });
    m.penalize('a', 0);
    expect(m.slowdownOf('a', 0)).toBe(2);
    expect(m.slowdownOf('b', 0)).toBe(1);
  });

  it('converges: after enough 429s the paced rate drops below a too-high ceiling', () => {
    // Ceiling models 100/s but the server truly tolerates ~20/s. Simulate: any
    // send faster than 50ms apart gets a 429. The model should settle at or
    // below the true interval.
    const m = new TokenBucketModel({ capacity: 1, refill: 100 }); // base T=10ms
    const trueIntervalMs = 50;
    let clock = 0;
    let lastAccepted = -Infinity;
    let rejections = 0;
    for (let i = 0; i < 200; i++) {
      const wait = m.reserve('k', clock);
      clock += wait;
      if (clock - lastAccepted < trueIntervalMs) {
        rejections++;
        m.penalize('k', clock);
      } else {
        lastAccepted = clock;
      }
      clock += 1; // a little wall time passes per attempt
    }
    // Early attempts trip the limit; the tail should be clean as it converges.
    const tailInterval = m.reserve('k', clock) + 0;
    expect(tailInterval).toBeGreaterThanOrEqual(trueIntervalMs * 0.5);
    expect(rejections).toBeLessThan(60); // it stops hammering, doesn't 429 forever
  });

  it('validates adaptive params', () => {
    expect(() => new TokenBucketModel({ capacity: 1, refill: 10, rejectBackoff: 0.5 })).toThrow(
      /rejectBackoff/
    );
    expect(() => new TokenBucketModel({ capacity: 1, refill: 10, maxSlowdown: 0 })).toThrow(
      /maxSlowdown/
    );
    expect(() => new TokenBucketModel({ capacity: 1, refill: 10, recoveryMs: 0 })).toThrow(
      /recoveryMs/
    );
  });
});
