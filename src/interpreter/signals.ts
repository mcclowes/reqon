/**
 * Marks an error a loop chose to tolerate, so the run does not report it as a
 * mission failure. Set on the error instance itself because executeStep records
 * the error before the loop gets a chance to catch it.
 */
export const TOLERATED = Symbol('reqon.tolerated');

export function markTolerated(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    (error as Record<symbol, unknown>)[TOLERATED] = true;
  }
}

export function isTolerated(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[TOLERATED] === true
  );
}

/**
 * Execution control flow signals
 *
 * These are used for non-exceptional control flow during pipeline execution.
 * They extend Error for easy stack-based propagation but represent expected
 * flow control, not actual errors.
 */

/**
 * Signal thrown when a match arm triggers skip
 */
export class SkipSignal extends Error {
  constructor() {
    super('Skip remaining steps');
    this.name = 'SkipSignal';
  }
}

/**
 * Signal thrown when a match arm triggers retry
 */
export class RetrySignal extends Error {
  constructor(public backoff?: { maxAttempts: number; backoff: string; initialDelay: number }) {
    super('Retry action');
    this.name = 'RetrySignal';
  }
}

/**
 * Signal thrown when a match arm triggers jump
 */
export class JumpSignal extends Error {
  constructor(
    public action: string,
    public then?: 'retry' | 'continue'
  ) {
    super(`Jump to action: ${action}`);
    this.name = 'JumpSignal';
  }
}

/**
 * Signal thrown when a match arm triggers queue
 */
export class QueueSignal extends Error {
  constructor(
    public value: unknown,
    public target?: string
  ) {
    super('Queue for later processing');
    this.name = 'QueueSignal';
  }
}

/**
 * Error thrown when a match step has no matching arm
 */
export class NoMatchError extends Error {
  constructor(
    public value: unknown,
    public arms?: string[]
  ) {
    super(
      arms?.length
        ? `No matching schema found for response. Tried: ${arms.join(', ')}. ` +
            'To carry on when nothing matches, add a `_` arm.'
        : 'No matching schema found for response'
    );
    this.name = 'NoMatchError';
  }
}

/**
 * Error thrown when a match arm triggers an abort
 */
export class AbortError extends Error {
  constructor(message?: string) {
    super(message ?? 'Execution aborted');
    this.name = 'AbortError';
  }
}

/**
 * Signal thrown when execution is paused by external control or pause step
 */
export class PauseSignal extends Error {
  /** Pause ID if created by a pause step */
  pauseId?: string;

  constructor(pauseId?: string) {
    super(pauseId ? `Execution paused (${pauseId})` : 'Execution paused');
    this.name = 'PauseSignal';
    this.pauseId = pauseId;
  }
}
