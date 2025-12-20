import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileStore } from './file.js';

describe('FileStore', () => {
  const TEST_DIR = '.reqon-test-stores';

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

  it('should create directory and file on first write', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice' });

    expect(existsSync(join(TEST_DIR, 'test-store.json'))).toBe(true);
  });

  it('should create .gitignore in data directory', () => {
    new FileStore('test-store', { baseDir: TEST_DIR });

    const gitignorePath = join(TEST_DIR, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('*.json');
  });

  it('should get a record by key', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice' });
    const record = await store.get('1');

    expect(record).toEqual({ id: '1', name: 'Alice' });
  });

  it('should return null for non-existent key', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    const record = await store.get('nonexistent');
    expect(record).toBeNull();
  });

  it('should update existing record', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice', age: 30 });
    await store.update('1', { age: 31 });

    const record = await store.get('1');
    expect(record).toEqual({ id: '1', name: 'Alice', age: 31 });
  });

  it('should create record on update if not exists', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.update('1', { name: 'Alice' });

    const record = await store.get('1');
    expect(record).toEqual({ name: 'Alice' });
  });

  it('should delete a record', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice' });
    await store.delete('1');

    const record = await store.get('1');
    expect(record).toBeNull();
  });

  it('should list all records', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice' });
    await store.set('2', { id: '2', name: 'Bob' });

    const records = await store.list();
    expect(records).toHaveLength(2);
  });

  it('should filter records with where clause', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice', active: true });
    await store.set('2', { id: '2', name: 'Bob', active: false });
    await store.set('3', { id: '3', name: 'Charlie', active: true });

    const records = await store.list({ where: { active: true } });
    expect(records).toHaveLength(2);
    expect(records.map(r => r.name)).toContain('Alice');
    expect(records.map(r => r.name)).toContain('Charlie');
  });

  it('should support limit and offset', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice' });
    await store.set('2', { id: '2', name: 'Bob' });
    await store.set('3', { id: '3', name: 'Charlie' });

    const records = await store.list({ offset: 1, limit: 1 });
    expect(records).toHaveLength(1);
  });

  it('should clear all records', async () => {
    const store = new FileStore('test-store', { baseDir: TEST_DIR });

    await store.set('1', { id: '1', name: 'Alice' });
    await store.set('2', { id: '2', name: 'Bob' });
    await store.clear();

    const records = await store.list();
    expect(records).toHaveLength(0);
  });

  describe('batch mode', () => {
    it('should not write to disk until flush in batch mode', async () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR, persist: 'batch' });
      const filePath = store.getFilePath();

      await store.set('1', { id: '1', name: 'Alice' });

      // File exists but should be empty or not contain data yet
      const contentBefore = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '{}';
      const parsedBefore = JSON.parse(contentBefore);
      expect(Object.keys(parsedBefore)).toHaveLength(0);

      // After flush, data should be persisted
      store.flush();

      const contentAfter = readFileSync(filePath, 'utf-8');
      const parsedAfter = JSON.parse(contentAfter);
      expect(parsedAfter['1']).toEqual({ id: '1', name: 'Alice' });
    });
  });

  describe('persistence', () => {
    it('should persist data across store instances', async () => {
      const store1 = new FileStore('test-store', { baseDir: TEST_DIR });
      await store1.set('1', { id: '1', name: 'Alice' });

      const store2 = new FileStore('test-store', { baseDir: TEST_DIR });
      const record = await store2.get('1');

      expect(record).toEqual({ id: '1', name: 'Alice' });
    });

    it('should reload data from disk', async () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR });
      await store.set('1', { id: '1', name: 'Alice' });

      // Manually modify the file
      const filePath = store.getFilePath();
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      content['1'].name = 'Modified';
      require('fs').writeFileSync(filePath, JSON.stringify(content));

      // Reload and check
      store.reload();
      const record = await store.get('1');
      expect(record?.name).toBe('Modified');
    });
  });

  describe('pretty printing', () => {
    it('should pretty-print JSON by default', async () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR });
      await store.set('1', { id: '1', name: 'Alice' });

      const content = readFileSync(store.getFilePath(), 'utf-8');
      expect(content).toContain('\n'); // Pretty printed has newlines
    });

    it('should compact JSON when pretty is false', async () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR, pretty: false });
      await store.set('1', { id: '1', name: 'Alice' });

      const content = readFileSync(store.getFilePath(), 'utf-8');
      expect(content).not.toContain('\n'); // Compact has no newlines
    });
  });

  describe('utilities', () => {
    it('should report size correctly', async () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR });

      expect(store.size()).toBe(0);

      await store.set('1', { id: '1' });
      await store.set('2', { id: '2' });

      expect(store.size()).toBe(2);
    });

    it('should dump all records', async () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR });

      await store.set('1', { id: '1', name: 'Alice' });
      await store.set('2', { id: '2', name: 'Bob' });

      const dump = store.dump();
      expect(dump).toHaveLength(2);
    });

    it('should return file path', () => {
      const store = new FileStore('test-store', { baseDir: TEST_DIR });
      expect(store.getFilePath()).toBe(join(TEST_DIR, 'test-store.json'));
    });
  });
});
