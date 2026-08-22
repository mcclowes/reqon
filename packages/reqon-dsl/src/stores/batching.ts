import type { StoreAdapter, StoreFilter } from './types.js';

/**
 * Default partial-flush interval. In strict mode a timer is not optional: a
 * bounded-concurrency loop keeps only N writes in flight, so a batch of `size`
 * larger than N never fills from writes alone and the awaiting writers would
 * hang forever. The timer flushes whatever has accumulated, so batch size is
 * effectively bounded by the loop's concurrency, and the run always progresses.
 */
const DEFAULT_MAX_DELAY_MS = 100;

export interface BatchOptions {
  /** Flush once this many buffered writes accumulate. */
  size: number;
  /**
   * Also flush a partial buffer this long after the first buffered write.
   * Defaults to {@link DEFAULT_MAX_DELAY_MS}; a timer is required so strict-mode
   * writes below the size threshold can't hang.
   */
  maxDelayMs?: number;
  /**
   * How a write's promise relates to durability:
   * - `strict` (default): `set`/`update` resolve only once their batch has been
   *   flushed to the underlying store. The caller (a `for` loop iteration) does
   *   not treat the item as done until it is durably written, and backpressures
   *   naturally. A flush failure rejects those writers, so it flows into the
   *   loop's `onError` policy.
   * - `relaxed`: resolve immediately and flush in the background. A crash loses
   *   whatever is still buffered. Fastest; a flush failure surfaces on `close`.
   */
  durability?: 'strict' | 'relaxed';
}

interface Pending {
  key: string;
  value: Record<string, unknown>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

const noop = (): void => {};

/**
 * Buffers per-record writes and flushes them to the underlying adapter in bulk.
 *
 * A `for … concurrency N` loop that does `store x -> managers` per iteration
 * otherwise issues one write per record - one HTTP POST per record against
 * PostgREST. Batching turns N writes into ceil(N / size) bulk calls, which is
 * what lets the store keep pace with a high-fan-out fetch.
 *
 * Flushes are serialised (chained) so bulk calls to the underlying store never
 * overlap; reads flush first so a write is visible immediately.
 */
export class BatchingStore implements StoreAdapter {
  private pendingSet: Pending[] = [];
  private pendingUpsert: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private relaxedError: unknown = null;
  private readonly durability: 'strict' | 'relaxed';
  private readonly maxDelayMs: number;

  constructor(
    private underlying: StoreAdapter,
    private opts: BatchOptions
  ) {
    this.durability = opts.durability ?? 'strict';
    this.maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  }

  private enqueue(list: Pending[], key: string, value: Record<string, unknown>): Promise<void> {
    if (this.durability === 'relaxed') {
      list.push({ key, value, resolve: noop, reject: noop });
      this.afterEnqueue();
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      list.push({ key, value, resolve, reject });
      this.afterEnqueue();
    });
  }

  private afterEnqueue(): void {
    if (this.pendingSet.length + this.pendingUpsert.length >= this.opts.size) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.maxDelayMs);
    }
  }

  /** Drain both buffers into one chained flush. Resolves (never rejects). */
  private flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const sets = this.pendingSet;
    const upserts = this.pendingUpsert;
    if (sets.length === 0 && upserts.length === 0) return this.flushChain;
    this.pendingSet = [];
    this.pendingUpsert = [];

    const run = this.flushChain.catch(noop).then(async () => {
      await this.flushGroup(sets, (r) =>
        this.underlying.bulkSet
          ? this.underlying.bulkSet(r)
          : this.perItem(r, (k, v) => this.underlying.set(k, v))
      );
      await this.flushGroup(upserts, (r) =>
        this.underlying.bulkUpsert
          ? this.underlying.bulkUpsert(r)
          : this.perItem(r, (k, v) => this.underlying.update(k, v))
      );
    });
    this.flushChain = run;
    return run;
  }

  private async flushGroup(
    group: Pending[],
    write: (records: Array<{ key: string; value: Record<string, unknown> }>) => Promise<void>
  ): Promise<void> {
    if (group.length === 0) return;
    try {
      await write(group.map((p) => ({ key: p.key, value: p.value })));
      for (const p of group) p.resolve();
    } catch (err) {
      // strict: reject the awaited writers so it reaches the loop's onError.
      // relaxed: those writers already resolved, so surface it on close().
      for (const p of group) p.reject(err);
      if (this.durability === 'relaxed') this.relaxedError ??= err;
    }
  }

  private async perItem(
    records: Array<{ key: string; value: Record<string, unknown> }>,
    op: (key: string, value: Record<string, unknown>) => Promise<void>
  ): Promise<void> {
    for (const { key, value } of records) await op(key, value);
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    return this.enqueue(this.pendingSet, key, value);
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    return this.enqueue(this.pendingUpsert, key, value as Record<string, unknown>);
  }

  /** Flush everything buffered and wait for the write chain to settle. */
  async flushNow(): Promise<void> {
    await this.flush();
    await this.flushChain;
  }

  /** Flush the final partial batch. Surfaces a relaxed-mode flush failure. */
  async close(): Promise<void> {
    await this.flushNow();
    if (this.relaxedError) {
      const err = this.relaxedError;
      this.relaxedError = null;
      throw err;
    }
  }

  // Reads and mutations that bypass the buffer flush pending writes first, so a
  // read never misses a just-written record and a delete/clear can't race it.
  async get(key: string): Promise<Record<string, unknown> | null> {
    await this.flushNow();
    return this.underlying.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.flushNow();
    return this.underlying.delete(key);
  }

  async list(filter?: StoreFilter): Promise<Record<string, unknown>[]> {
    await this.flushNow();
    return this.underlying.list(filter);
  }

  async count(filter?: StoreFilter): Promise<number> {
    await this.flushNow();
    return this.underlying.count(filter);
  }

  async clear(): Promise<void> {
    await this.flushNow();
    return this.underlying.clear();
  }
}
