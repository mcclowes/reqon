/**
 * Store adapter benchmarks
 */

import { MemoryStore } from '../stores/memory.js';
import { applyStoreFilter } from '../stores/types.js';
import { BenchmarkSuite, generateRecords } from './utils.js';

export async function runStoreBenchmarks(): Promise<void> {
  const suite = new BenchmarkSuite('MemoryStore Operations');

  // Prepare test data
  const smallRecords = generateRecords(100);
  const mediumRecords = generateRecords(1000);
  const largeRecords = generateRecords(10000);

  // Individual set operations
  await suite.addAsync('set-single', async () => {
    const store = new MemoryStore('test');
    await store.set('key-1', { id: '1', value: 42 });
  });

  // Batch set operations
  await suite.addAsync('set-100-records', async () => {
    const store = new MemoryStore('test');
    for (const record of smallRecords) {
      await store.set(record.id as string, record);
    }
  }, { iterations: 100 });

  await suite.addAsync('set-1000-records', async () => {
    const store = new MemoryStore('test');
    for (const record of mediumRecords) {
      await store.set(record.id as string, record);
    }
  }, { iterations: 50, warmupIterations: 5 });

  // Get operations (pre-populate store)
  const prePopulatedStore = new MemoryStore('prepopulated');
  for (const record of mediumRecords) {
    await prePopulatedStore.set(record.id as string, record);
  }

  await suite.addAsync('get-existing', async () => {
    await prePopulatedStore.get('record-500');
  });

  await suite.addAsync('get-nonexistent', async () => {
    await prePopulatedStore.get('nonexistent-key');
  });

  await suite.addAsync('get-100-sequential', async () => {
    for (let i = 0; i < 100; i++) {
      await prePopulatedStore.get(`record-${i}`);
    }
  }, { iterations: 100 });

  // Update operations
  await suite.addAsync('update-existing', async () => {
    await prePopulatedStore.update('record-500', { updated: true });
  });

  await suite.addAsync('update-100-records', async () => {
    for (let i = 0; i < 100; i++) {
      await prePopulatedStore.update(`record-${i}`, { updated: true });
    }
  }, { iterations: 100 });

  // List operations
  await suite.addAsync('list-all-1000', async () => {
    await prePopulatedStore.list();
  }, { iterations: 100 });

  // Large store for list benchmarks
  const largeStore = new MemoryStore('large');
  for (const record of largeRecords) {
    await largeStore.set(record.id as string, record);
  }

  await suite.addAsync('list-all-10000', async () => {
    await largeStore.list();
  }, { iterations: 20, warmupIterations: 5 });

  // List with filters
  await suite.addAsync('list-with-limit-100', async () => {
    await largeStore.list({ limit: 100 });
  }, { iterations: 100 });

  await suite.addAsync('list-with-offset-and-limit', async () => {
    await largeStore.list({ offset: 5000, limit: 100 });
  }, { iterations: 100 });

  await suite.addAsync('list-with-where-clause', async () => {
    await largeStore.list({ where: { active: true } });
  }, { iterations: 50, warmupIterations: 5 });

  // Delete operations
  await suite.addAsync('delete-single', async () => {
    const store = new MemoryStore('test');
    await store.set('key-1', { id: '1' });
    await store.delete('key-1');
  });

  suite.print();

  // Filter function benchmarks
  const filterSuite = new BenchmarkSuite('applyStoreFilter');

  filterSuite.addSync('no-filter-1000', () => {
    return applyStoreFilter(mediumRecords);
  });

  filterSuite.addSync('no-filter-10000', () => {
    return applyStoreFilter(largeRecords);
  }, { iterations: 100 });

  filterSuite.addSync('limit-only-1000', () => {
    return applyStoreFilter(mediumRecords, { limit: 100 });
  });

  filterSuite.addSync('offset-limit-1000', () => {
    return applyStoreFilter(mediumRecords, { offset: 500, limit: 100 });
  });

  filterSuite.addSync('where-simple-1000', () => {
    return applyStoreFilter(mediumRecords, { where: { active: true } });
  });

  filterSuite.addSync('where-simple-10000', () => {
    return applyStoreFilter(largeRecords, { where: { active: true } });
  }, { iterations: 100 });

  filterSuite.addSync('where-multiple-conditions', () => {
    return applyStoreFilter(largeRecords, {
      where: { active: true },
      offset: 100,
      limit: 50,
    });
  }, { iterations: 100 });

  filterSuite.print();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStoreBenchmarks().catch(console.error);
}
