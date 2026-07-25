---
sidebar_position: 5
---

# Custom store adapters

You can connect Reqon to any storage backend by implementing the `StoreAdapter`
interface and supplying your instance at runtime.

:::note
There's no public plugin API for registering a new store *keyword*. The DSL only
recognises `memory`, `file`, `sql`, `nosql`, and `postgrest`. A custom adapter is
wired in by name (see [Using a custom adapter](#using-a-custom-adapter)), not by
inventing a new store type in the mission file.
:::

## Store interface

Implement this TypeScript interface (from `reqon`):

```typescript
interface StoreAdapter {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  update(key: string, value: Partial<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
  list(filter?: StoreFilter): Promise<Record<string, unknown>[]>;
  count(filter?: StoreFilter): Promise<number>;
  clear(): Promise<void>;

  // Optional bulk operations — implement them for more efficient writes.
  // When present, store steps use them automatically.
  bulkSet?(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void>;
  bulkUpsert?(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void>;
}

interface StoreFilter {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}
```

`where` is an equality map: a record matches when every `field === value`. There's
no operator vocabulary (no `gt`, `neq`, `contains`, and so on) — the built-in
stores all filter on equality. `count` applies only the `where` clause and ignores
`limit`/`offset`.

## Basic example

### Redis adapter

```typescript
import { createClient } from 'redis';
import type { StoreAdapter, StoreFilter } from 'reqon';

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

  async update(key: string, value: Partial<Record<string, unknown>>) {
    const existing = await this.get(key);
    await this.set(key, { ...(existing ?? {}), ...value });
  }

  async delete(key: string) {
    await this.client.del(this.key(key));
  }

  async list(filter?: StoreFilter) {
    const keys = await this.client.keys(`${this.prefix}:*`);
    const items: Record<string, unknown>[] = [];

    for (const k of keys) {
      const data = await this.client.get(k);
      if (data) items.push(JSON.parse(data));
    }

    return this.applyFilter(items, filter);
  }

  async count(filter?: StoreFilter) {
    // count ignores limit/offset
    const items = await this.list({ where: filter?.where });
    return items.length;
  }

  async clear() {
    const keys = await this.client.keys(`${this.prefix}:*`);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  private applyFilter(items: Record<string, unknown>[], filter?: StoreFilter) {
    if (!filter) return items;
    let result = items;

    if (filter.where) {
      const where = filter.where;
      result = result.filter((item) =>
        Object.entries(where).every(([field, value]) => item[field] === value)
      );
    }

    if (filter.offset) result = result.slice(filter.offset);
    if (filter.limit) result = result.slice(0, filter.limit);

    return result;
  }
}
```

## Using a custom adapter

Pass your adapter through the `stores` option, keyed by the store name from the
mission. The adapter replaces whatever store the mission declared under that name,
so declare any valid store type as a placeholder:

```typescript
import { execute } from 'reqon';
import { RedisStoreAdapter } from './redis-adapter';

const cache = new RedisStoreAdapter('redis://localhost:6379', 'my-cache');
await cache.connect();

await execute(
  `
  mission Test {
    store cache: memory("my-cache")

    action Fetch {
      get "/data"
      store response -> cache { key: .id }
    }

    run Fetch
  }
  `,
  {
    // keyed by the store name (`store cache: ...`)
    stores: { cache },
  }
);
```

The same `stores` option works with `fromFile` and `fromPath`.

## Best practices

### Connection management

```typescript
class MyAdapter implements StoreAdapter {
  private connected = false;

  private async ensureConnected() {
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
    throw new Error(`Failed to set ${key}: ${(error as Error).message}`);
  }
}
```

### Bulk writes

Implement `bulkSet` and `bulkUpsert` when your backend supports batch writes.
Store steps that write arrays use them automatically, which avoids one round trip
per record:

```typescript
async bulkSet(records: Array<{ key: string; value: Record<string, unknown> }>) {
  await this.client.mset(records.map((r) => [this.key(r.key), JSON.stringify(r.value)]));
}
```

## Testing adapters

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RedisStoreAdapter } from './redis-adapter';

describe('RedisStoreAdapter', () => {
  let adapter: RedisStoreAdapter;

  beforeEach(async () => {
    adapter = new RedisStoreAdapter('redis://localhost:6379', 'test');
    await adapter.connect();
    await adapter.clear();
  });

  afterEach(async () => {
    await adapter.clear();
  });

  it('should set and get', async () => {
    await adapter.set('key1', { name: 'test' });
    const result = await adapter.get('key1');
    expect(result).toEqual({ name: 'test' });
  });

  it('should list with an equality filter', async () => {
    await adapter.set('1', { id: '1', status: 'active' });
    await adapter.set('2', { id: '2', status: 'inactive' });

    const result = await adapter.list({ where: { status: 'active' } });

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('active');
  });
});
```
</content>
