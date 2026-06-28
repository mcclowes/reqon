/**
 * Timers for delays beyond Node's 32-bit setTimeout limit.
 *
 * Node stores the delay in a 32-bit signed int: anything over 2_147_483_647 ms
 * (~24.8 days) overflows and the callback fires almost immediately. A multi-week
 * webhook wait or pause would therefore time out at once. `setLongTimeout`
 * chains native timeouts so arbitrarily long delays fire at the right time.
 */

/** Largest delay (ms) Node's setTimeout handles without overflowing. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export interface LongTimeout {
  /** Cancel the pending timeout. */
  clear(): void;
}

/**
 * Schedule `callback` to run after `delayMs`, correctly handling delays larger
 * than {@link MAX_TIMEOUT_MS} by chaining native timeouts.
 */
export function setLongTimeout(callback: () => void, delayMs: number): LongTimeout {
  let remaining = Math.max(0, delayMs);
  let timer: ReturnType<typeof setTimeout>;

  const schedule = (): void => {
    if (remaining <= MAX_TIMEOUT_MS) {
      timer = setTimeout(callback, remaining);
    } else {
      remaining -= MAX_TIMEOUT_MS;
      timer = setTimeout(schedule, MAX_TIMEOUT_MS);
    }
  };

  schedule();

  return {
    clear() {
      clearTimeout(timer);
    },
  };
}
