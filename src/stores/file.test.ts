import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileStore } from './file.js';

describe('FileStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filestore-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('JSON format', () => {
    it('should create file on first write', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });

      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({ id: '1', name: 'Alice' });
    });

    it('should get a record by key', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });
      const record = await store.get('1');

      expect(record).toEqual({ id: '1', name: 'Alice' });
    });

    it('should return null for non-existent key', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      const record = await store.get('nonexistent');
      expect(record).toBeNull();
    });

    it('should update existing record', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice', age: 30 });
      await store.update('1', { age: 31 });

      const record = await store.get('1');
      expect(record).toEqual({ id: '1', name: 'Alice', age: 31 });
    });

    it('should delete a record', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });
      await store.delete('1');

      const record = await store.get('1');
      expect(record).toBeNull();
    });

    it('should list all records', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });
      await store.set('2', { id: '2', name: 'Bob' });

      const records = await store.list();
      expect(records).toHaveLength(2);
    });

    it('should filter records with where clause', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice', active: true });
      await store.set('2', { id: '2', name: 'Bob', active: false });
      await store.set('3', { id: '3', name: 'Charlie', active: true });

      const records = await store.list({ where: { active: true } });
      expect(records).toHaveLength(2);
      expect(records.map(r => r.name)).toContain('Alice');
      expect(records.map(r => r.name)).toContain('Charlie');
    });

    it('should support limit and offset', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });
      await store.set('2', { id: '2', name: 'Bob' });
      await store.set('3', { id: '3', name: 'Charlie' });

      const records = await store.list({ offset: 1, limit: 1 });
      expect(records).toHaveLength(1);
    });

    it('should clear all records', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });
      await store.set('2', { id: '2', name: 'Bob' });
      await store.clear();

      const records = await store.list();
      expect(records).toHaveLength(0);
    });

    it('should load existing JSON array file', async () => {
      const filePath = path.join(tempDir, 'existing.json');
      await fs.writeFile(filePath, JSON.stringify([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]));

      const store = new FileStore(filePath);
      const records = await store.list();

      expect(records).toHaveLength(2);
      expect(records[0].name).toBe('Alice');
    });

    it('should load existing JSON object file', async () => {
      const filePath = path.join(tempDir, 'existing.json');
      await fs.writeFile(filePath, JSON.stringify({
        user1: { id: 'user1', name: 'Alice' },
        user2: { id: 'user2', name: 'Bob' }
      }));

      const store = new FileStore(filePath);
      const records = await store.list();

      expect(records).toHaveLength(2);
    });
  });

  describe('CSV format', () => {
    it('should create CSV file on first write', async () => {
      const filePath = path.join(tempDir, 'data.csv');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice', age: 30 });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('id');
      expect(content).toContain('name');
      expect(content).toContain('Alice');
    });

    it('should infer CSV format from extension', async () => {
      const filePath = path.join(tempDir, 'data.csv');
      const store = new FileStore(filePath);

      expect(store.getFormat()).toBe('csv');
    });

    it('should get a record by key', async () => {
      const filePath = path.join(tempDir, 'data.csv');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice', age: 30 });
      const record = await store.get('1');

      expect(record).toEqual({ id: '1', name: 'Alice', age: 30 });
    });

    it('should load existing CSV file', async () => {
      const filePath = path.join(tempDir, 'existing.csv');
      await fs.writeFile(filePath, 'id,name,age\n1,Alice,30\n2,Bob,25');

      const store = new FileStore(filePath);
      const records = await store.list();

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({ id: 1, name: 'Alice', age: 30 });
      expect(records[1]).toEqual({ id: 2, name: 'Bob', age: 25 });
    });

    it('should handle quoted values with commas', async () => {
      const filePath = path.join(tempDir, 'existing.csv');
      await fs.writeFile(filePath, 'id,name,bio\n1,"Smith, John","Hello, world"');

      const store = new FileStore(filePath);
      const record = await store.get('1');

      expect(record?.name).toBe('Smith, John');
      expect(record?.bio).toBe('Hello, world');
    });

    it('should handle quoted values with escaped quotes', async () => {
      const filePath = path.join(tempDir, 'existing.csv');
      await fs.writeFile(filePath, 'id,name,quote\n1,Alice,"She said ""Hello"""');

      const store = new FileStore(filePath);
      const record = await store.get('1');

      expect(record?.quote).toBe('She said "Hello"');
    });

    it('should parse boolean and null values', async () => {
      const filePath = path.join(tempDir, 'existing.csv');
      await fs.writeFile(filePath, 'id,active,deleted,notes\n1,true,false,null');

      const store = new FileStore(filePath);
      const record = await store.get('1');

      expect(record?.active).toBe(true);
      expect(record?.deleted).toBe(false);
      expect(record?.notes).toBeNull();
    });

    it('should use custom delimiter', async () => {
      const filePath = path.join(tempDir, 'data.csv');
      const store = new FileStore(filePath, { delimiter: ';' });

      await store.set('1', { id: '1', name: 'Alice', age: 30 });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('id;name;age');
      expect(content).toContain('1;Alice;30');
    });

    it('should escape values containing delimiter', async () => {
      const filePath = path.join(tempDir, 'data.csv');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Smith, John' });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('"Smith, John"');
    });
  });

  describe('format override', () => {
    it('should allow explicit format override', async () => {
      const filePath = path.join(tempDir, 'data.txt');
      const store = new FileStore(filePath, { format: 'json' });

      expect(store.getFormat()).toBe('json');
    });
  });

  describe('edge cases', () => {
    it('should handle non-existent file gracefully', async () => {
      const filePath = path.join(tempDir, 'nonexistent.json');
      const store = new FileStore(filePath);

      const records = await store.list();
      expect(records).toHaveLength(0);
    });

    it('should create parent directories if needed', async () => {
      const filePath = path.join(tempDir, 'nested', 'dir', 'data.json');
      const store = new FileStore(filePath);

      await store.set('1', { id: '1', name: 'Alice' });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(content)).toHaveLength(1);
    });

    it('should persist data across store instances', async () => {
      const filePath = path.join(tempDir, 'data.json');

      const store1 = new FileStore(filePath);
      await store1.set('1', { id: '1', name: 'Alice' });

      const store2 = new FileStore(filePath);
      const record = await store2.get('1');

      expect(record).toEqual({ id: '1', name: 'Alice' });
    });
  });
});
