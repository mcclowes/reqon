/**
 * Utility functions for async operations
 */

/**
 * Sleep for a specified number of milliseconds. Ends early (resolving, not
 * rejecting) when `signal` aborts; callers check the signal afterwards.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
