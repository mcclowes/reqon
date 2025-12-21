import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './memory.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore('test');
  });

  describe('set and get', () => {
    it('stores and retrieves a value', async () => {
      await store.set('key1', { id: '1', name: 'Test' });
      const result = await store.get('key1');

      expect(result).toEqual({ id: '1', name: 'Test' });
    });

    it('returns null for non-existent key', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('stores a copy of the value (not reference)', async () => {
      const original = { id: '1', name: 'Test' };
      await store.set('key1', original);

      original.name = 'Modified';
      const result = await store.get('key1');

      expect(result?.name).toBe('Test');
    });

    it('overwrites existing value', async () => {
      await store.set('key1', { id: '1', name: 'First' });
      await store.set('key1', { id: '1', name: 'Second' });

      const result = await store.get('key1');
      expect(result?.name).toBe('Second');
    });
  });

  describe('update', () => {
    it('merges partial values with existing', async () => {
      await store.set('key1', { id: '1', name: 'Test', status: 'active' });
      await store.update('key1', { status: 'inactive' });

      const result = await store.get('key1');
      expect(result).toEqual({ id: '1', name: 'Test', status: 'inactive' });
    });

    it('creates new record if key does not exist', async () => {
      await store.update('new-key', { id: '1', name: 'New' });

      const result = await store.get('new-key');
      expect(result).toEqual({ id: '1', name: 'New' });
    });

    it('preserves unmodified fields', async () => {
      await store.set('key1', { a: 1, b: 2, c: 3 });
      await store.update('key1', { b: 20 });

      const result = await store.get('key1');
      expect(result).toEqual({ a: 1, b: 20, c: 3 });
    });
  });

  describe('delete', () => {
    it('removes a record', async () => {
      await store.set('key1', { id: '1' });
      await store.delete('key1');

      const result = await store.get('key1');
      expect(result).toBeNull();
    });

    it('handles deleting non-existent key', async () => {
      // Should not throw
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.set('1', { id: '1', name: 'Alice', age: 30, status: 'active' });
      await store.set('2', { id: '2', name: 'Bob', age: 25, status: 'inactive' });
      await store.set('3', { id: '3', name: 'Charlie', age: 35, status: 'active' });
      await store.set('4', { id: '4', name: 'Diana', age: 28, status: 'active' });
      await store.set('5', { id: '5', name: 'Eve', age: 32, status: 'inactive' });
    });

    it('returns all records when no filter', async () => {
      const results = await store.list();
      expect(results).toHaveLength(5);
    });

    it('filters by where clause', async () => {
      const results = await store.list({ where: { status: 'active' } });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'active')).toBe(true);
    });

    it('filters by multiple where conditions', async () => {
      const results = await store.list({
        where: { status: 'active', age: 30 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('applies limit', async () => {
      const results = await store.list({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('applies offset', async () => {
      const allResults = await store.list();
      const offsetResults = await store.list({ offset: 2 });

      expect(offsetResults).toHaveLength(3);
      expect(offsetResults[0]).toEqual(allResults[2]);
    });

    it('applies limit and offset together', async () => {
      const allResults = await store.list();
      const results = await store.list({ offset: 1, limit: 2 });

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(allResults[1]);
      expect(results[1]).toEqual(allResults[2]);
    });

    it('combines where, limit, and offset', async () => {
      const results = await store.list({
        where: { status: 'active' },
        offset: 1,
        limit: 1,
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('active');
    });

    it('returns empty array when where matches nothing', async () => {
      const results = await store.list({ where: { status: 'unknown' } });
      expect(results).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all records', async () => {
      await store.set('1', { id: '1' });
      await store.set('2', { id: '2' });
      await store.set('3', { id: '3' });

      await store.clear();

      const results = await store.list();
      expect(results).toHaveLength(0);
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await store.set('1', { id: '1', name: 'Alice', status: 'active' });
      await store.set('2', { id: '2', name: 'Bob', status: 'inactive' });
      await store.set('3', { id: '3', name: 'Charlie', status: 'active' });
      await store.set('4', { id: '4', name: 'Diana', status: 'active' });
    });

    it('returns total count when no filter', async () => {
      const count = await store.count();
      expect(count).toBe(4);
    });

    it('returns count matching where clause', async () => {
      const count = await store.count({ where: { status: 'active' } });
      expect(count).toBe(3);
    });

    it('returns 0 when no records match', async () => {
      const count = await store.count({ where: { status: 'unknown' } });
      expect(count).toBe(0);
    });

    it('ignores limit and offset for counting', async () => {
      // limit/offset should not affect count - count returns total matching records
      const count = await store.count({ where: { status: 'active' }, limit: 1, offset: 1 });
      expect(count).toBe(3);
    });

    it('returns 0 for empty store', async () => {
      await store.clear();
      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe('size', () => {
    it('returns 0 for empty store', () => {
      expect(store.size()).toBe(0);
    });

    it('returns correct count', async () => {
      await store.set('1', { id: '1' });
      await store.set('2', { id: '2' });

      expect(store.size()).toBe(2);
    });

    it('updates after delete', async () => {
      await store.set('1', { id: '1' });
      await store.set('2', { id: '2' });
      await store.delete('1');

      expect(store.size()).toBe(1);
    });
  });

  describe('dump', () => {
    it('returns all values as array', async () => {
      await store.set('1', { id: '1', name: 'First' });
      await store.set('2', { id: '2', name: 'Second' });

      const dump = store.dump();

      expect(dump).toHaveLength(2);
      expect(dump).toContainEqual({ id: '1', name: 'First' });
      expect(dump).toContainEqual({ id: '2', name: 'Second' });
    });

    it('returns empty array for empty store', () => {
      expect(store.dump()).toEqual([]);
    });
  });
});
