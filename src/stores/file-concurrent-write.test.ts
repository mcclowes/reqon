import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileStore } from './file.js';

/**
 * `for ... concurrency N` drives N stores in flight against one file. Each write
 * serialises a snapshot of the map and then renames it over the target, so
 * without ordering an older snapshot can land after a newer one and silently
 * drop the newer key. The in-memory map still reports it as stored.
 */
describe('FileStore under concurrent writes', () => {
  const TEST_DIR = '.reqon-test-concurrent';

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const readFromDisk = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(TEST_DIR, `${name}.json`), 'utf-8'));

  it('persists every key when sets are issued concurrently', async () => {
    const store = new FileStore('fanout', { baseDir: TEST_DIR });
    const ids = Array.from({ length: 50 }, (_, i) => String(i + 1));

    await Promise.all(ids.map((id) => store.set(id, { id, payload: `value-${id}` })));

    const onDisk = readFromDisk('fanout');
    expect(Object.keys(onDisk).sort()).toEqual(ids.sort());
    expect(store.size()).toBe(ids.length);
  });

  it('persists every key when upserts are issued concurrently', async () => {
    const store = new FileStore('fanout-upsert', { baseDir: TEST_DIR });
    const ids = Array.from({ length: 50 }, (_, i) => String(i + 1));

    await Promise.all(ids.map((id) => store.update(id, { id, payload: `value-${id}` })));

    const onDisk = readFromDisk('fanout-upsert');
    expect(Object.keys(onDisk).sort()).toEqual(ids.sort());
  });

  it('leaves the last write winning rather than an earlier snapshot', async () => {
    const store = new FileStore('ordering', { baseDir: TEST_DIR });

    await Promise.all([
      store.set('a', { id: 'a', n: 1 }),
      store.set('b', { id: 'b', n: 2 }),
      store.set('c', { id: 'c', n: 3 }),
    ]);
    await store.set('d', { id: 'd', n: 4 });

    expect(existsSync(join(TEST_DIR, 'ordering.json'))).toBe(true);
    expect(Object.keys(readFromDisk('ordering')).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
