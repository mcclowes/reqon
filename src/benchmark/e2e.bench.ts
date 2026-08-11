/**
 * End-to-end execution benchmarks
 */

import { parse, execute } from '../index.js';
import { MissionExecutor } from '../interpreter/index.js';
import { MemoryStore } from '../stores/memory.js';
import { BenchmarkSuite } from './utils.js';
import {
  SIMPLE_DSL,
  MEDIUM_DSL,
  COMPLEX_DSL,
  EXPRESSION_HEAVY_DSL,
  MATCH_HEAVY_DSL,
  STORE_ONLY_DSL,
  COMPLEX_STORE_DSL,
  generateLargeDSL,
} from './fixtures.js';

function generateUsers(count: number): Record<string, unknown>[] {
  const users: Record<string, unknown>[] = [];
  const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Davis'];
  const tiers = ['A', 'B', 'C'];

  for (let i = 0; i < count; i++) {
    users.push({
      id: `user-${i}`,
      firstName: firstNames[i % firstNames.length],
      lastName: lastNames[i % lastNames.length],
      email: `user${i}@example.com`,
      age: 20 + (i % 50),
      value: Math.floor(Math.random() * 100),
      score: Math.floor(Math.random() * 100),
      tier: tiers[i % tiers.length],
      active: Math.random() > 0.2,
      verified: Math.random() > 0.3,
    });
  }
  return users;
}

function generateOrders(count: number, userCount: number): Record<string, unknown>[] {
  const orders: Record<string, unknown>[] = [];
  const statuses = ['pending', 'completed', 'cancelled'];

  for (let i = 0; i < count; i++) {
    orders.push({
      id: `order-${i}`,
      userId: `user-${i % userCount}`,
      amount: Math.floor(Math.random() * 500) + 10,
      status: statuses[i % statuses.length],
      items: Math.floor(Math.random() * 10) + 1,
    });
  }
  return orders;
}

export async function runE2EBenchmarks(): Promise<void> {
  // Parse-only benchmarks
  const parseSuite = new BenchmarkSuite('Parse (Lexer + Parser)');

  parseSuite.addSync('simple', () => {
    return parse(SIMPLE_DSL);
  });

  parseSuite.addSync('medium', () => {
    return parse(MEDIUM_DSL);
  });

  parseSuite.addSync('complex', () => {
    return parse(COMPLEX_DSL);
  });

  parseSuite.addSync('expression-heavy', () => {
    return parse(EXPRESSION_HEAVY_DSL);
  });

  parseSuite.addSync('match-heavy', () => {
    return parse(MATCH_HEAVY_DSL);
  });

  const largeDsl20 = generateLargeDSL(20);
  parseSuite.addSync(
    'large-20-actions',
    () => {
      return parse(largeDsl20);
    },
    { iterations: 500 }
  );

  parseSuite.print();

  // Execution benchmarks with pre-populated stores
  // These fixtures declare no source and issue no fetch, so they run for real
  // rather than under dryRun - which skips every store write, and so would
  // benchmark store processing without the stores.
  const execSuite = new BenchmarkSuite('Execute (with pre-populated stores)');

  // Small dataset (100 items)
  const smallUsers = generateUsers(100);
  const smallOrders = generateOrders(200, 100);

  await execSuite.addAsync(
    'store-processing-100-items',
    async () => {
      const inputStore = new MemoryStore('input');
      for (const user of smallUsers) {
        await inputStore.set(user.id as string, user);
      }

      const outputStore = new MemoryStore('output');

      await execute(STORE_ONLY_DSL, {
        stores: {
          input: inputStore,
          output: outputStore,
        },
      });
    },
    { iterations: 100, warmupIterations: 10 }
  );

  // Medium dataset (500 items)
  const mediumUsers = generateUsers(500);
  const mediumOrders = generateOrders(1000, 500);

  await execSuite.addAsync(
    'store-processing-500-items',
    async () => {
      const inputStore = new MemoryStore('input');
      for (const user of mediumUsers) {
        await inputStore.set(user.id as string, user);
      }

      const outputStore = new MemoryStore('output');

      await execute(STORE_ONLY_DSL, {
        stores: {
          input: inputStore,
          output: outputStore,
        },
      });
    },
    { iterations: 50, warmupIterations: 5 }
  );

  // Complex processing with multiple stores
  await execSuite.addAsync(
    'complex-processing-100-users-200-orders',
    async () => {
      const usersStore = new MemoryStore('users');
      const ordersStore = new MemoryStore('orders');
      const reportsStore = new MemoryStore('reports');

      for (const user of smallUsers) {
        await usersStore.set(user.id as string, user);
      }
      for (const order of smallOrders) {
        await ordersStore.set(order.id as string, order);
      }

      await execute(COMPLEX_STORE_DSL, {
        stores: {
          users: usersStore,
          orders: ordersStore,
          reports: reportsStore,
        },
      });
    },
    { iterations: 50, warmupIterations: 5 }
  );

  await execSuite.addAsync(
    'complex-processing-500-users-1000-orders',
    async () => {
      const usersStore = new MemoryStore('users');
      const ordersStore = new MemoryStore('orders');
      const reportsStore = new MemoryStore('reports');

      for (const user of mediumUsers) {
        await usersStore.set(user.id as string, user);
      }
      for (const order of mediumOrders) {
        await ordersStore.set(order.id as string, order);
      }

      await execute(COMPLEX_STORE_DSL, {
        stores: {
          users: usersStore,
          orders: ordersStore,
          reports: reportsStore,
        },
      });
    },
    { iterations: 20, warmupIterations: 3 }
  );

  execSuite.print();

  // Executor instantiation benchmarks
  const executorSuite = new BenchmarkSuite('MissionExecutor Instantiation');

  executorSuite.addSync('basic-config', () => {
    return new MissionExecutor({});
  });

  executorSuite.addSync('full-config', () => {
    return new MissionExecutor({
      dryRun: true,
      verbose: false,
      stores: {},
      auth: { api: { type: 'bearer', token: 'test' } },
    });
  });

  executorSuite.addSync('with-stores', () => {
    return new MissionExecutor({
      stores: {
        store1: new MemoryStore('store1'),
        store2: new MemoryStore('store2'),
        store3: new MemoryStore('store3'),
      },
    });
  });

  executorSuite.print();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runE2EBenchmarks().catch(console.error);
}
