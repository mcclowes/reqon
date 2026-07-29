import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Closing a store is the moment its data must be on disk. These tests pin the
 * contract that close() quiesces the async write chain before returning, so an
 * in-flight write can never rename older data over the final state (#259).
 */

// Gate writeFileAtomic on demand so a write can be held mid-flight.
const gates: Array<() => void> = [];
let gateNext = 0;

vi.mock('../utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/file.js')>();
  return {
    ...actual,
    writeFileAtomic: vi.fn(async (path: string, content: string) => {
      if (gateNext > 0) {
        gateNext--;
        await new Promise<void>((resolve) => gates.push(resolve));
      }
      return actual.writeFileAtomic(path, content);
    }),
  };
});

import { FileStore } from './file.js';

const TEST_DIR = '.reqon-test-close';
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await tick(1);
  }
};
const readFromDisk = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(TEST_DIR, `${name}.json`), 'utf-8'));

describe('FileStore.close', () => {
  beforeEach(() => {
    gates.length = 0;
    gateNext = 0;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    while (gates.length) gates.shift()!();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('persists un-awaited immediate-mode writes before returning', async () => {
    const store = new FileStore('immediate', { baseDir: TEST_DIR });

    void store.set('1', { id: '1' });
    void store.set('2', { id: '2' });
    await store.close();

    expect(Object.keys(readFromDisk('immediate')).sort()).toEqual(['1', '2']);
  });

  it('does not let an in-flight debounced write clobber the final state', async () => {
    const store = new FileStore('debounced', {
      baseDir: TEST_DIR,
      persist: 'debounce',
      debounceMs: 1,
    });

    await store.set('a', { id: 'a' });
    gateNext = 1;
    await tick(10); // debounce timer fires; its write is now held mid-flight
    await store.set('b', { id: 'b' });

    const closing = store.close();
    await tick(5);
    gates.shift()?.(); // release the stale write while close is waiting
    await closing;
    await tick(10); // give a stale write every chance to land after close

    expect(Object.keys(readFromDisk('debounced')).sort()).toEqual(['a', 'b']);
  });

  it('persists batch-mode data on close', async () => {
    const store = new FileStore('batched', { baseDir: TEST_DIR, persist: 'batch' });

    await store.set('1', { id: '1' });
    await store.set('2', { id: '2' });
    await store.close();

    expect(Object.keys(readFromDisk('batched')).sort()).toEqual(['1', '2']);
  });

  it('persists a mutation that lands while an earlier write is in flight', async () => {
    const store = new FileStore('late-dirty', { baseDir: TEST_DIR, persist: 'batch' });

    await store.set('a', { id: 'a' });
    gateNext = 1;
    const flushing = store.flush();
    await waitFor(() => gates.length > 0); // {a} snapshotted, write held mid-flight
    await store.set('b', { id: 'b' }); // arrives after the snapshot
    gates.shift()?.();
    await flushing;
    await store.close();

    expect(Object.keys(readFromDisk('late-dirty')).sort()).toEqual(['a', 'b']);
  });
});
