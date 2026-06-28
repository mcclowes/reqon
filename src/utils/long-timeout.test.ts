import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLongTimeout, MAX_TIMEOUT_MS } from './long-timeout.js';

describe('setLongTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires a normal (in-range) delay at the right time', () => {
    const cb = vi.fn();
    setLongTimeout(cb, 5000);

    vi.advanceTimersByTime(4999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not fire early for a delay beyond the 32-bit limit', () => {
    const cb = vi.fn();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000; // ~2.59e9 ms, over the limit

    setLongTimeout(cb, THIRTY_DAYS);

    // A raw setTimeout would have fired ~immediately here.
    vi.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(THIRTY_DAYS - MAX_TIMEOUT_MS - 1);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('can be cancelled before firing', () => {
    const cb = vi.fn();
    const handle = setLongTimeout(cb, 10 * 24 * 60 * 60 * 1000);

    handle.clear();
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    expect(cb).not.toHaveBeenCalled();
  });
});
