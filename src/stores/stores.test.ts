import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { FileStore } from './file.js';
import { createStore, resolveStoreType } from './factory.js';

const TEST_DIR = '.reqon-test-data';

describe('FileStore', () => {
  let store: FileStore;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    store = new FileStore('test-store', { baseDir: TEST_DIR });
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('creates data directory and .gitignore', () => {
    expect(existsSync(TEST_DIR)).toBe(true);
    expect(existsSync(`${TEST_DIR}/.gitignore`)).toBe(true);
  });

  it('stores and retrieves data', async () => {
    await store.set('item-1', { id: '1', name: 'Test Item' });
    const retrieved = await store.get('item-1');

    expect(retrieved).toEqual({ id: '1', name: 'Test Item' });
  });

  it('persists data to disk', async () => {
    await store.set('item-1', { id: '1', name: 'Persisted' });

    // Create new store instance pointing to same file
    const newStore = new FileStore('test-store', { baseDir: TEST_DIR });
    const retrieved = await newStore.get('item-1');

    expect(retrieved).toEqual({ id: '1', name: 'Persisted' });
  });

  it('returns null for missing keys', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('updates existing records', async () => {
    await store.set('item-1', { id: '1', name: 'Original', count: 0 });
    await store.update('item-1', { count: 5 });

    const retrieved = await store.get('item-1');
    expect(retrieved).toEqual({ id: '1', name: 'Original', count: 5 });
  });

  it('deletes records', async () => {
    await store.set('item-1', { id: '1' });
    await store.delete('item-1');

    const result = await store.get('item-1');
    expect(result).toBeNull();
  });

  it('lists all records', async () => {
    await store.set('a', { id: 'a', type: 'x' });
    await store.set('b', { id: 'b', type: 'y' });
    await store.set('c', { id: 'c', type: 'x' });

    const all = await store.list();
    expect(all).toHaveLength(3);
  });

  it('filters records with where clause', async () => {
    await store.set('a', { id: 'a', type: 'x' });
    await store.set('b', { id: 'b', type: 'y' });
    await store.set('c', { id: 'c', type: 'x' });

    const filtered = await store.list({ where: { type: 'x' } });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.type === 'x')).toBe(true);
  });

  it('clears all records', async () => {
    await store.set('a', { id: 'a' });
    await store.set('b', { id: 'b' });
    await store.clear();

    const all = await store.list();
    expect(all).toHaveLength(0);
  });

  it('supports batch mode with flush', async () => {
    const batchStore = new FileStore('batch-test', {
      baseDir: TEST_DIR,
      persist: 'batch',
    });

    await batchStore.set('item-1', { id: '1' });
    await batchStore.set('item-2', { id: '2' });

    // Before flush, new instance won't see changes
    const beforeFlush = new FileStore('batch-test', { baseDir: TEST_DIR });
    expect(await beforeFlush.get('item-1')).toBeNull();

    // After flush, changes are persisted
    batchStore.flush();
    const afterFlush = new FileStore('batch-test', { baseDir: TEST_DIR });
    expect(await afterFlush.get('item-1')).toEqual({ id: '1' });
  });
});

describe('createStore factory', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('creates memory store', async () => {
    const store = createStore({ type: 'memory', name: 'test' });
    await store.set('key', { value: 1 });
    expect(await store.get('key')).toEqual({ value: 1 });
  });

  it('creates file store', async () => {
    const store = createStore({
      type: 'file',
      name: 'test',
      baseDir: TEST_DIR,
    });
    await store.set('key', { value: 1 });

    // Verify persistence
    const newStore = createStore({
      type: 'file',
      name: 'test',
      baseDir: TEST_DIR,
    });
    expect(await newStore.get('key')).toEqual({ value: 1 });
  });

  it('falls back to file for sql in dev mode', async () => {
    const store = createStore({
      type: 'sql',
      name: 'test',
      baseDir: TEST_DIR,
    });
    await store.set('key', { value: 1 });
    expect(await store.get('key')).toEqual({ value: 1 });
  });

  it('falls back to file for nosql in dev mode', async () => {
    const store = createStore({
      type: 'nosql',
      name: 'test',
      baseDir: TEST_DIR,
    });
    await store.set('key', { value: 1 });
    expect(await store.get('key')).toEqual({ value: 1 });
  });
});

describe('resolveStoreType', () => {
  it('keeps memory as memory', () => {
    expect(resolveStoreType('memory', true)).toBe('memory');
    expect(resolveStoreType('memory', false)).toBe('memory');
  });

  it('maps sql to file in dev mode', () => {
    expect(resolveStoreType('sql', true)).toBe('file');
  });

  it('maps nosql to file in dev mode', () => {
    expect(resolveStoreType('nosql', true)).toBe('file');
  });

  it('keeps sql as sql in production mode', () => {
    expect(resolveStoreType('sql', false)).toBe('sql');
  });

  it('keeps nosql as nosql in production mode', () => {
    expect(resolveStoreType('nosql', false)).toBe('nosql');
  });
});
