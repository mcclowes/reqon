import { describe, it, expect, vi } from 'vitest';
import { ObservabilityEmitter } from './events.js';
import {
  ProgressReporter,
  formatProgressLine,
  formatCount,
  formatDuration,
  type ProgressSnapshot,
} from './progress.js';

/** A controllable clock so throttling and rates are deterministic. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

describe('formatDuration', () => {
  it('renders seconds under a minute', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-100)).toBe('0s');
  });

  it('renders minutes and seconds under an hour', () => {
    expect(formatDuration(2 * 60_000)).toBe('2m00s');
    expect(formatDuration(2 * 60_000 + 5_000)).toBe('2m05s');
  });

  it('renders hours and minutes past an hour', () => {
    expect(formatDuration(60_000 * 93)).toBe('1h33m');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(12_431)).toBe('12,431');
    expect(formatCount(500_000)).toBe('500,000');
    expect(formatCount(7)).toBe('7');
  });
});

describe('formatProgressLine', () => {
  it('matches the documented shape', () => {
    const snapshot: ProgressSnapshot = {
      processed: 12_431,
      total: 500_000,
      reqPerSec: 87,
      p50Ms: 112,
      retries: 3,
      failed: 0,
      elapsedMs: 1000,
      etaMs: 60_000 * 93,
    };
    expect(formatProgressLine(snapshot)).toBe(
      '12,431/500,000 (2.5%) · 87 req/s · p50 112ms · 3 retries · 0 failed · ETA 1h33m'
    );
  });

  it('omits total/percentage and ETA when unknown', () => {
    const line = formatProgressLine({
      processed: 40,
      reqPerSec: 10,
      retries: 0,
      failed: 2,
      elapsedMs: 4000,
    });
    expect(line).toBe('40 · 10 req/s · 0 retries · 2 failed');
  });

  it('omits p50 when no fetches have completed', () => {
    const line = formatProgressLine({
      processed: 5,
      total: 10,
      reqPerSec: 0,
      retries: 0,
      failed: 0,
      elapsedMs: 100,
    });
    expect(line).not.toContain('p50');
  });

  it('uses the singular "retry" for exactly one', () => {
    const line = formatProgressLine({
      processed: 1,
      reqPerSec: 1,
      retries: 1,
      failed: 0,
      elapsedMs: 100,
    });
    expect(line).toContain('1 retry ·');
  });
});

describe('ProgressReporter', () => {
  it('throttles to at most one snapshot per interval', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const onSnapshot = vi.fn();
    new ProgressReporter(emitter, { onSnapshot, intervalMs: 2000, now: clock.now });

    emitter.emit('loop.start', { variable: 'x', collectionSize: 100, hasFilter: false });

    // Three heartbeats inside the same 2s window -> at most one render.
    for (let i = 1; i <= 3; i++) {
      clock.advance(500);
      emitter.emit('loop.heartbeat', {
        variable: 'x',
        current: i * 10,
        total: 100,
        processedCount: i * 10,
      });
    }
    expect(onSnapshot).toHaveBeenCalledTimes(0);

    clock.advance(1000); // now 2500ms since start -> past the interval
    emitter.emit('loop.heartbeat', { variable: 'x', current: 40, total: 100, processedCount: 40 });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('renders early once itemInterval items have passed', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const onSnapshot = vi.fn();
    new ProgressReporter(emitter, {
      onSnapshot,
      intervalMs: 100_000,
      itemInterval: 50,
      now: clock.now,
    });

    emitter.emit('loop.start', { variable: 'x', collectionSize: 1000, hasFilter: false });
    emitter.emit('loop.heartbeat', { variable: 'x', current: 60, total: 1000, processedCount: 60 });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0][0]).toMatchObject({ processed: 60, total: 1000 });
  });

  it('counts retries and failures', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const reporter = new ProgressReporter(emitter, { onSnapshot: vi.fn(), now: clock.now });

    emitter.emit('fetch.retry', {
      source: 's',
      path: '/',
      attempt: 2,
      maxAttempts: 3,
      reason: '429',
      waitMs: 100,
    });
    emitter.emit('fetch.retry', {
      source: 's',
      path: '/',
      attempt: 2,
      maxAttempts: 3,
      reason: '500',
      waitMs: 100,
    });
    emitter.emit('fetch.error', { source: 's', path: '/', error: 'boom', retryable: false });
    emitter.emit('loop.item.failed', { variable: 'x', itemIndex: 3, error: 'nope' });

    const snap = reporter.snapshot();
    expect(snap.retries).toBe(2);
    expect(snap.failed).toBe(2);
  });

  it('computes p50 latency from fetch.complete ms', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const reporter = new ProgressReporter(emitter, { onSnapshot: vi.fn(), now: clock.now });

    for (const ms of [100, 200, 300]) {
      emitter.emit('fetch.complete', {
        source: 's',
        method: 'GET',
        path: '/',
        statusCode: 200,
        recordCount: 1,
        ms,
      });
    }
    expect(reporter.snapshot().p50Ms).toBe(200);
  });

  it('computes req/s over the rolling window', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const reporter = new ProgressReporter(emitter, {
      onSnapshot: vi.fn(),
      rateWindowMs: 1000,
      now: clock.now,
    });

    // 5 completions spread across a full 1s window.
    for (let i = 0; i < 5; i++) {
      emitter.emit('fetch.complete', {
        source: 's',
        method: 'GET',
        path: '/',
        statusCode: 200,
        recordCount: 1,
        ms: 10,
      });
      clock.advance(200);
    }
    // At t=1000 the window holds the last 5 completions (t=0..800), 5 req / 1s.
    expect(reporter.snapshot(1000).reqPerSec).toBe(5);
  });

  it('estimates ETA from the overall processing rate', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const reporter = new ProgressReporter(emitter, { onSnapshot: vi.fn(), now: clock.now });

    emitter.emit('loop.start', { variable: 'x', collectionSize: 100, hasFilter: false });
    clock.set(10_000); // 10s elapsed
    emitter.emit('loop.heartbeat', { variable: 'x', current: 50, total: 100, processedCount: 50 });

    // 50 items in 10s -> 5/s; 50 remaining -> ~10s ETA.
    const snap = reporter.snapshot(10_000);
    expect(snap.etaMs).toBeCloseTo(10_000, -2);
  });

  it('finish() forces a render and stop() detaches subscriptions', () => {
    const clock = fakeClock();
    const emitter = new ObservabilityEmitter('exec', 'mission');
    const onSnapshot = vi.fn();
    const reporter = new ProgressReporter(emitter, { onSnapshot, now: clock.now });

    reporter.finish();
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    reporter.stop();
    emitter.emit('loop.heartbeat', { variable: 'x', current: 10, total: 100, processedCount: 10 });
    clock.advance(10_000);
    emitter.emit('loop.heartbeat', { variable: 'x', current: 20, total: 100, processedCount: 20 });
    expect(onSnapshot).toHaveBeenCalledTimes(1); // no further renders after stop()
  });
});
