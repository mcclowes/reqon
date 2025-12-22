---
sidebar_position: 5
---

# Custom store adapters

Create custom store adapters to connect Reqon to any storage backend.

## Store interface

Implement this TypeScript interface:

```typescript
interface StoreAdapter {
  // Get a single record by key
  get(key: string): Promise<Record<string, unknown> | null>;

  // Set a record with key
  set(key: string, value: Record<string, unknown>): Promise<void>;

  // Update a record (partial update)
  update(key: string, partial: Record<string, unknown>): Promise<void>;

  // Delete a record by key
  delete(key: string): Promise<void>;

  // List all records, optionally filtered
  list(filter?: FilterOptions): Promise<Record<string, unknown>[]>;

  // Clear all records
  clear(): Promise<void>;
}

interface FilterOptions {
  where?: WhereClause[];
  limit?: number;
  offset?: number;
}

interface WhereClause {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: unknown;
}
```

## Basic example

### Redis adapter

```typescript
import { createClient } from 'redis';
import { StoreAdapter, FilterOptions } from 'reqon';

export class RedisStoreAdapter implements StoreAdapter {
  private client: ReturnType<typeof createClient>;
  private prefix: string;

  constructor(url: string, prefix: string) {
    this.client = createClient({ url });
    this.prefix = prefix;
  }

  async connect() {
    await this.client.connect();
  }

  private key(id: string) {
    return `${this.prefix}:${id}`;
  }

  async get(key: string) {
    const data = await this.client.get(this.key(key));
    return data ? JSON.parse(data) : null;
  }

  async set(key: string, value: Record<string, unknown>) {
    await this.client.set(this.key(key), JSON.stringify(value));
  }

  async update(key: string, partial: Record<string, unknown>) {
    const existing = await this.get(key);
    if (existing) {
      await this.set(key, { ...existing, ...partial });
    }
  }

  async delete(key: string) {
    await this.client.del(this.key(key));
  }

  async list(filter?: FilterOptions) {
    const keys = await this.client.keys(`${this.prefix}:*`);
    const items: Record<string, unknown>[] = [];

    for (const key of keys) {
      const data = await this.client.get(key);
      if (data) {
        items.push(JSON.parse(data));
      }
    }

    return this.applyFilter(items, filter);
  }

  async clear() {
    const keys = await this.client.keys(`${this.prefix}:*`);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  private applyFilter(items: Record<string, unknown>[], filter?: FilterOptions) {
    let result = items;

    if (filter?.where) {
      result = result.filter(item =>
        filter.where!.every(clause => this.evaluateClause(item, clause))
      );
    }

    if (filter?.offset) {
      result = result.slice(filter.offset);
    }

    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  private evaluateClause(item: Record<string, unknown>, clause: WhereClause) {
    const value = item[clause.field];

    switch (clause.operator) {
      case 'eq': return value === clause.value;
      case 'neq': return value !== clause.value;
      case 'gt': return (value as number) > (clause.value as number);
      case 'gte': return (value as number) >= (clause.value as number);
      case 'lt': return (value as number) < (clause.value as number);
      case 'lte': return (value as number) <= (clause.value as number);
      case 'contains': return String(value).includes(String(clause.value));
      default: return true;
    }
  }
}
```

## MongoDB adapter

```typescript
import { MongoClient, Db, Collection } from 'mongodb';
import { StoreAdapter, FilterOptions } from 'reqon';

export class MongoStoreAdapter implements StoreAdapter {
  private client: MongoClient;
  private db: Db;
  private collection: Collection;

  constructor(url: string, database: string, collectionName: string) {
    this.client = new MongoClient(url);
    this.db = this.client.db(database);
    this.collection = this.db.collection(collectionName);
  }

  async connect() {
    await this.client.connect();
  }

  async get(key: string) {
    const doc = await this.collection.findOne({ _id: key });
    if (!doc) return null;
    const { _id, ...data } = doc;
    return { id: _id, ...data };
  }

  async set(key: string, value: Record<string, unknown>) {
    await this.collection.replaceOne(
      { _id: key },
      { _id: key, ...value },
      { upsert: true }
    );
  }

  async update(key: string, partial: Record<string, unknown>) {
    await this.collection.updateOne(
      { _id: key },
      { $set: partial }
    );
  }

  async delete(key: string) {
    await this.collection.deleteOne({ _id: key });
  }

  async list(filter?: FilterOptions) {
    const query = this.buildQuery(filter?.where);
    let cursor = this.collection.find(query);

    if (filter?.offset) {
      cursor = cursor.skip(filter.offset);
    }

    if (filter?.limit) {
      cursor = cursor.limit(filter.limit);
    }

    const docs = await cursor.toArray();
    return docs.map(({ _id, ...data }) => ({ id: _id, ...data }));
  }

  async clear() {
    await this.collection.deleteMany({});
  }

  private buildQuery(clauses?: WhereClause[]) {
    if (!clauses || clauses.length === 0) return {};

    const query: Record<string, unknown> = {};

    for (const clause of clauses) {
      const field = clause.field;
      switch (clause.operator) {
        case 'eq': query[field] = clause.value; break;
        case 'neq': query[field] = { $ne: clause.value }; break;
        case 'gt': query[field] = { $gt: clause.value }; break;
        case 'gte': query[field] = { $gte: clause.value }; break;
        case 'lt': query[field] = { $lt: clause.value }; break;
        case 'lte': query[field] = { $lte: clause.value }; break;
        case 'contains': query[field] = { $regex: clause.value }; break;
      }
    }

    return query;
  }
}
```

## Registering custom adapters

```typescript
import { execute, registerStoreAdapter } from 'reqon';
import { RedisStoreAdapter } from './redis-adapter';

// Register the adapter
registerStoreAdapter('redis', async (name: string, config: any) => {
  const adapter = new RedisStoreAdapter(config.url, name);
  await adapter.connect();
  return adapter;
});

// Use in mission
await execute(`
  mission Test {
    store cache: redis("my-cache")

    action Fetch {
      get "/data"
      store response -> cache { key: .id }
    }

    run Fetch
  }
`, {
  storeConfig: {
    redis: {
      url: 'redis://localhost:6379'
    }
  }
});
```

## Best practices

### Connection management

```typescript
class MyAdapter implements StoreAdapter {
  private connected = false;

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
      this.connected = true;
    }
  }

  async get(key: string) {
    await this.ensureConnected();
    // ...
  }
}
```

### Error handling

```typescript
async set(key: string, value: Record<string, unknown>) {
  try {
    await this.client.set(key, value);
  } catch (error) {
    throw new StoreError(`Failed to set ${key}: ${error.message}`);
  }
}
```

### Connection pooling

```typescript
class PooledAdapter implements StoreAdapter {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = createPool(config);
  }

  async get(key: string) {
    const conn = await this.pool.acquire();
    try {
      return await conn.get(key);
    } finally {
      this.pool.release(conn);
    }
  }
}
```

### Batch operations

```typescript
async setMany(items: Array<{ key: string; value: unknown }>) {
  // Override for efficient batch writes
  await this.client.mset(items);
}
```

## Testing adapters

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MyCustomAdapter } from './my-adapter';

describe('MyCustomAdapter', () => {
  let adapter: MyCustomAdapter;

  beforeEach(async () => {
    adapter = new MyCustomAdapter(/* config */);
    await adapter.connect();
    await adapter.clear();
  });

  afterEach(async () => {
    await adapter.clear();
    await adapter.disconnect();
  });

  it('should set and get', async () => {
    await adapter.set('key1', { name: 'test' });
    const result = await adapter.get('key1');
    expect(result).toEqual({ name: 'test' });
  });

  it('should list with filter', async () => {
    await adapter.set('1', { status: 'active' });
    await adapter.set('2', { status: 'inactive' });

    const result = await adapter.list({
      where: [{ field: 'status', operator: 'eq', value: 'active' }]
    });

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('active');
  });
});
```
