/**
 * Progress Reporter - a progress-shaped view of a running mission.
 *
 * `--verbose` used to narrate every item ("Fetching: GET /x", "Item 3 failed").
 * On a 500k-record backfill that is noise, not signal. This reporter instead
 * folds the `loop.heartbeat` and `fetch.complete` event streams into a single
 * throttled progress line:
 *
 *   12,431/500,000 (2.5%) · 87 req/s · p50 112ms · 3 retries · 0 failed · ETA 1h33m
 *
 * emitted at most once every `intervalMs` (default 2s) or every `itemInterval`
 * processed items, whichever comes first. Per-item narration moves down to
 * `--log-level debug`.
 */

import type {
  EventEmitter,
  ObservabilityEvent,
  FetchCompletePayload,
  LoopStartPayload,
  LoopHeartbeatPayload,
  LoopCompletePayload,
} from './events.js';

/** A point-in-time summary of mission progress. */
export interface ProgressSnapshot {
  /** Items processed so far (loop iterations, or fetches when there is no loop). */
  processed: number;
  /** Total items to process, when known (from `loop.start`). */
  total?: number;
  /** Rolling request rate over the recent window, requests per second. */
  reqPerSec: number;
  /** Median fetch latency in ms over recent requests, when any have completed. */
  p50Ms?: number;
  /** Number of retry attempts observed. */
  retries: number;
  /** Number of failed items / requests observed. */
  failed: number;
  /** Wall-clock elapsed since the reporter started, in ms. */
  elapsedMs: number;
  /** Estimated time remaining in ms, when a total and a rate are both known. */
  etaMs?: number;
}

export interface ProgressReporterOptions {
  /** Called with a fresh snapshot each time a line is due. */
  onSnapshot: (snapshot: ProgressSnapshot) => void;
  /** Minimum ms between rendered lines (default 2000). */
  intervalMs?: number;
  /** Force a line after this many processed items even within the interval (default 1000). */
  itemInterval?: number;
  /** Rolling window for the req/s rate, in ms (default 5000). */
  rateWindowMs?: number;
  /** Max latency samples kept for the p50 (bounds memory on large runs; default 1024). */
  maxLatencySamples?: number;
  /** Clock source, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_ITEM_INTERVAL = 1000;
const DEFAULT_RATE_WINDOW_MS = 5000;
const DEFAULT_MAX_LATENCY_SAMPLES = 1024;

/**
 * Subscribes to an event emitter and folds the loop/fetch streams into a
 * throttled sequence of {@link ProgressSnapshot}s. Formatting lives in
 * {@link formatProgressLine} so the same snapshot can render as a human line or
 * a JSON object.
 */
export class ProgressReporter {
  private readonly opts: Required<Omit<ProgressReporterOptions, 'onSnapshot'>> &
    Pick<ProgressReporterOptions, 'onSnapshot'>;
  private readonly unsubscribes: Array<() => void> = [];
  private readonly startTime: number;

  private processed = 0;
  private total?: number;
  private retries = 0;
  private failed = 0;

  /** Completion timestamps within the rate window, for req/s. */
  private completionTimes: number[] = [];
  /** Recent latencies (ms), ring-bounded, for the p50. */
  private latencies: number[] = [];

  private lastRenderTime: number;
  private lastRenderProcessed = 0;

  constructor(emitter: EventEmitter, options: ProgressReporterOptions) {
    this.opts = {
      onSnapshot: options.onSnapshot,
      intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
      itemInterval: options.itemInterval ?? DEFAULT_ITEM_INTERVAL,
      rateWindowMs: options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS,
      maxLatencySamples: options.maxLatencySamples ?? DEFAULT_MAX_LATENCY_SAMPLES,
      now: options.now ?? Date.now,
    };
    this.startTime = this.opts.now();
    this.lastRenderTime = this.startTime;

    this.unsubscribes.push(
      emitter.on<LoopStartPayload>('loop.start', (e) => this.onLoopStart(e)),
      emitter.on<LoopHeartbeatPayload>('loop.heartbeat', (e) => this.onLoopHeartbeat(e)),
      emitter.on<LoopCompletePayload>('loop.complete', (e) => this.onLoopComplete(e)),
      emitter.on('loop.item.failed', () => {
        this.failed++;
      }),
      emitter.on<FetchCompletePayload>('fetch.complete', (e) => this.onFetchComplete(e)),
      emitter.on('fetch.error', () => {
        this.failed++;
      }),
      emitter.on('fetch.retry', () => {
        this.retries++;
      })
    );
  }

  private onLoopStart(event: ObservabilityEvent<LoopStartPayload>): void {
    // Sum collection sizes so nested/sequential loops report a combined total.
    this.total = (this.total ?? 0) + event.payload.collectionSize;
  }

  private onLoopHeartbeat(event: ObservabilityEvent<LoopHeartbeatPayload>): void {
    // processedCount is monotonic; heartbeat.current can be a worker index under
    // concurrency, so prefer the count.
    this.processed = Math.max(this.processed, event.payload.processedCount);
    this.maybeRender();
  }

  private onLoopComplete(event: ObservabilityEvent<LoopCompletePayload>): void {
    this.processed = Math.max(this.processed, event.payload.itemsProcessed);
  }

  private onFetchComplete(event: ObservabilityEvent<FetchCompletePayload>): void {
    const now = this.opts.now();
    this.completionTimes.push(now);
    this.pruneCompletions(now);

    const ms = event.payload.ms;
    if (typeof ms === 'number' && Number.isFinite(ms)) {
      this.latencies.push(ms);
      if (this.latencies.length > this.opts.maxLatencySamples) {
        this.latencies.shift();
      }
    }
    this.maybeRender();
  }

  private pruneCompletions(now: number): void {
    const cutoff = now - this.opts.rateWindowMs;
    // Timestamps are pushed in order, so drop the stale prefix in one pass.
    let drop = 0;
    while (drop < this.completionTimes.length && this.completionTimes[drop] < cutoff) {
      drop++;
    }
    if (drop > 0) this.completionTimes.splice(0, drop);
  }

  private maybeRender(): void {
    const now = this.opts.now();
    const dueByTime = now - this.lastRenderTime >= this.opts.intervalMs;
    const dueByItems = this.processed - this.lastRenderProcessed >= this.opts.itemInterval;
    if (dueByTime || dueByItems) {
      this.render(now);
    }
  }

  private render(now: number): void {
    this.lastRenderTime = now;
    this.lastRenderProcessed = this.processed;
    this.opts.onSnapshot(this.snapshot(now));
  }

  /** Build a snapshot without rendering (also used by tests). */
  snapshot(now: number = this.opts.now()): ProgressSnapshot {
    this.pruneCompletions(now);
    const elapsedMs = now - this.startTime;

    // req/s over the rolling window; fall back to elapsed while it is not yet full.
    const windowMs = Math.min(this.opts.rateWindowMs, Math.max(elapsedMs, 1));
    const reqPerSec = this.completionTimes.length / (windowMs / 1000);

    // Overall processing rate drives ETA (steadier than the rolling window).
    const itemsPerSec = elapsedMs > 0 ? this.processed / (elapsedMs / 1000) : 0;
    let etaMs: number | undefined;
    if (this.total !== undefined && itemsPerSec > 0 && this.processed < this.total) {
      etaMs = ((this.total - this.processed) / itemsPerSec) * 1000;
    }

    return {
      processed: this.processed,
      total: this.total,
      reqPerSec: Math.round(reqPerSec),
      p50Ms: this.percentile(50),
      retries: this.retries,
      failed: this.failed,
      elapsedMs,
      etaMs,
    };
  }

  private percentile(p: number): number | undefined {
    if (this.latencies.length === 0) return undefined;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round(sorted[idx]);
  }

  /** Emit a final line immediately, regardless of throttling. */
  finish(): void {
    this.render(this.opts.now());
  }

  /** Detach all event subscriptions. */
  stop(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }
}

/**
 * Render a snapshot as the human-readable progress line. Fields with no data
 * (unknown total, no fetches yet, unknown ETA) are omitted rather than shown as
 * zero, so the line never implies precision it doesn't have.
 */
export function formatProgressLine(s: ProgressSnapshot): string {
  const parts: string[] = [];

  if (s.total !== undefined) {
    const pct = s.total > 0 ? ((s.processed / s.total) * 100).toFixed(1) : '0.0';
    parts.push(`${formatCount(s.processed)}/${formatCount(s.total)} (${pct}%)`);
  } else {
    parts.push(formatCount(s.processed));
  }

  parts.push(`${formatCount(s.reqPerSec)} req/s`);

  if (s.p50Ms !== undefined) {
    parts.push(`p50 ${s.p50Ms}ms`);
  }

  parts.push(`${formatCount(s.retries)} ${s.retries === 1 ? 'retry' : 'retries'}`);
  parts.push(`${formatCount(s.failed)} failed`);

  if (s.etaMs !== undefined) {
    parts.push(`ETA ${formatDuration(s.etaMs)}`);
  }

  return parts.join(' · ');
}

/** Group digits with thousands separators (12431 -> "12,431"). */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Compact human duration: "1h33m", "2m", "45s". Rounds to whole seconds and
 * drops zero leading units so short and long durations both read cleanly.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
