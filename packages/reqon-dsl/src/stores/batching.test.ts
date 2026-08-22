import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchingStore } from './batching.js';
import { MemoryStore } from './memory.js';
import type { StoreAdapter } from './types.js';

/**
 * A recording adapter: counts how many times the bulk methods were actually
 * invoked, so we can prove batching collapses N writes into far fewer calls.
 */
class RecordingStore implements StoreAdapter {
  inner = new MemoryStore('rec');
  bulkSetCalls = 0;
  bulkUpsertCalls = 0;
  setCalls = 0;

  async get(k: string) {
    return this.inner.get(k);
  }
  async set(k: string, v: Record<string, unknown>) {
    this.setCalls++;
    return this.inner.set(k, v);
  }
  async update(k: string, v: Record<string, unknown>) {
    return this.inner.update(k, v);
  }
  async delete(k: string) {
    return this.inner.delete(k);
  }
  async list() {
    return this.inner.list();
  }
  async count() {
    return this.inner.count();
  }
  async clear() {
    return this.inner.clear();
  }
  async bulkSet(records: Array<{ key: string; value: Record<string, unknown> }>) {
    this.bulkSetCalls++;
    return this.inner.bulkSet(records);
  }
  async bulkUpsert(records: Array<{ key: string; value: Record<string, unknown> }>) {
    this.bulkUpsertCalls++;
    return this.inner.bulkUpsert(records);
  }
}

describe('BatchingStore', () => {
  let rec: RecordingStore;

  beforeEach(() => {
    rec = new RecordingStore();
  });

  it('flushes one bulk call per `size` records', async () => {
    // Relaxed so all 250 enqueue without blocking; size (not the timer) drives
    // the flushes, and close() sweeps the remainder.
    const store = new BatchingStore(rec, { size: 100, maxDelayMs: 60_000, durability: 'relaxed' });
    await Promise.all(Array.from({ length: 250 }, (_, i) => store.update(String(i), { id: i })));
    await store.close();

    // 250 upserts / 100 = 3 flushes (100, 100, 50), not 250 individual writes.
    expect(rec.bulkUpsertCalls).toBe(3);
    expect(rec.setCalls).toBe(0);
    expect(await rec.count()).toBe(250);
  });

  it('routes set to bulkSet and update to bulkUpsert', async () => {
    const store = new BatchingStore(rec, { size: 2, maxDelayMs: 60_000 });
    await Promise.all([store.set('a', { id: 'a' }), store.set('b', { id: 'b' })]);
    await Promise.all([store.update('c', { id: 'c' }), store.update('d', { id: 'd' })]);
    await store.close();

    expect(rec.bulkSetCalls).toBe(1);
    expect(rec.bulkUpsertCalls).toBe(1);
  });

  it('flushes a partial batch on close', async () => {
    // Relaxed: writes resolve immediately, so a below-size buffer survives until
    // close flushes it.
    const store = new BatchingStore(rec, { size: 1000, maxDelayMs: 60_000, durability: 'relaxed' });
    await store.set('1', { id: 1 });
    await store.set('2', { id: 2 });
    expect(rec.bulkSetCalls).toBe(0); // nothing flushed yet

    await store.close();
    expect(rec.bulkSetCalls).toBe(1);
    expect(await rec.count()).toBe(2);
  });

  it('strict: a write resolves only after its batch has flushed', async () => {
    const store = new BatchingStore(rec, { size: 3, maxDelayMs: 60_000, durability: 'strict' });
    const flags = [false, false, false];
    // Fire without awaiting so the batch can fill; awaiting each would deadlock
    // below size, which is exactly why strict needs a timer in real use.
    const p1 = store.set('1', { id: 1 }).then(() => (flags[0] = true));
    const p2 = store.set('2', { id: 2 }).then(() => (flags[1] = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(flags.slice(0, 2)).toEqual([false, false]); // 2 < size, still buffered

    const p3 = store.set('3', { id: 3 }).then(() => (flags[2] = true)); // hits size -> flush
    await Promise.all([p1, p2, p3]);
    expect(flags).toEqual([true, true, true]);
    expect(rec.bulkSetCalls).toBe(1);
  });

  it('relaxed: a write resolves immediately, flush happens later', async () => {
    const store = new BatchingStore(rec, { size: 1000, maxDelayMs: 60_000, durability: 'relaxed' });
    await store.set('1', { id: 1 });
    await store.set('2', { id: 2 });
    // Resolved without a flush; buffer still holds the records.
    expect(rec.bulkSetCalls).toBe(0);
    await store.close();
    expect(rec.bulkSetCalls).toBe(1);
    expect(await rec.count()).toBe(2);
  });

  it('flushes a partial batch after maxDelayMs', async () => {
    vi.useFakeTimers();
    try {
      const store = new BatchingStore(rec, { size: 1000, maxDelayMs: 200 });
      const p = store.update('1', { id: 1 });
      expect(rec.bulkUpsertCalls).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(rec.bulkUpsertCalls).toBe(1);
      expect(await rec.count()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads flush pending writes first (read-after-write)', async () => {
    const store = new BatchingStore(rec, { size: 1000, maxDelayMs: 60_000 });
    store.update('7', { id: 7, name: 'seven' }); // buffered, not awaited
    // get() forces a flush, so the just-written record is visible.
    expect(await store.get('7')).toEqual({ id: 7, name: 'seven' });
  });

  it('propagates a flush failure to the buffered writers (strict)', async () => {
    const failing = new RecordingStore();
    failing.bulkUpsert = async () => {
      throw new Error('flush boom');
    };
    const store = new BatchingStore(failing, { size: 2, maxDelayMs: 60_000, durability: 'strict' });
    const p1 = store.update('1', { id: 1 });
    const p2 = store.update('2', { id: 2 }); // hits size -> flush -> rejects both
    await expect(Promise.all([p1, p2])).rejects.toThrow('flush boom');
  });

  it('surfaces a relaxed-mode flush failure on close', async () => {
    const failing = new RecordingStore();
    failing.bulkSet = async () => {
      throw new Error('late boom');
    };
    const store = new BatchingStore(failing, {
      size: 1000,
      maxDelayMs: 60_000,
      durability: 'relaxed',
    });
    await store.set('1', { id: 1 }); // resolves immediately
    await expect(store.close()).rejects.toThrow('late boom');
  });
});
