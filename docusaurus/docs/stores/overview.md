---
sidebar_position: 1
---

# Store adapters overview

Store adapters provide pluggable backends for data persistence. Reqon includes a
few built-in adapters and lets you supply your own.

## Available adapters

| Adapter | Description | Best for |
|---------|-------------|----------|
| `memory` | In-memory hash map | Testing, temporary data |
| `file` | JSON file storage in `.reqon-data/` | Local development |
| `postgrest` | PostgreSQL via PostgREST or Supabase | Production |
| `sql` | Falls back to a file store in development mode; otherwise needs a PostgREST backend | See below |
| `nosql` | Not implemented; falls back to a file store in development mode | See below |

`sql` and `nosql` aren't standalone database adapters. With development mode on
(`--dev`), both write to local JSON files. Without it, `sql` only works if you wire
up a PostgREST backend for it, and `nosql` has no implementation at all. There's no
MongoDB or DynamoDB adapter. For production storage, use `postgrest`.

## Quick start

```vague
mission DataSync {
  // Define stores
  store cache: memory("cache")
  store data: file("my-data")

  action Process {
    get "/items"

    // Write to a store
    store response -> data { key: .id }
  }
}
```

## Store interface

All adapters implement this interface (see [Custom adapters](./custom-adapters) for the full version):

```typescript
interface StoreAdapter {
  // Read
  get(key: string): Promise<Record<string, unknown> | null>;
  list(filter?: StoreFilter): Promise<Record<string, unknown>[]>;
  count(filter?: StoreFilter): Promise<number>;

  // Write
  set(key: string, value: Record<string, unknown>): Promise<void>;
  update(key: string, value: Partial<Record<string, unknown>>): Promise<void>;

  // Delete
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface StoreFilter {
  where?: Record<string, unknown>; // equality match
  limit?: number;
  offset?: number;
}
```

## Writing data

### Basic store

```vague
store response -> myStore
```

Without a `key:`, the store key falls back to `record.id`. If the record has no
`id` (or it's empty), the step throws rather than inventing a key, so re-runs don't
silently duplicate data.

### With key

```vague
store response -> myStore { key: .id }
```

### Upsert mode

Insert or update based on the key:

```vague
store response -> myStore { key: .id, upsert: true }
```

### Partial update

Deep-merge into the existing record. `partial: true` behaves the same as `upsert`
at runtime:

```vague
store response -> myStore { key: .id, partial: true }
```

## Reading data

### In for loops

```vague
for item in myStore {
  // Process each item
}
```

### With filtering

```vague
for item in myStore where .status == "active" {
  // Process active items
}
```

### Multiple conditions

```vague
for item in myStore where .status == "pending" and .priority > 5 {
  // Process high-priority pending items
}
```

### Cross-store joins

```vague
for order in orders {
  for customer in customers where .id == order.customerId {
    // Join data from multiple stores
  }
}
```

## Choosing an adapter

### Development

```vague
// Use file for local development
store data: file("my-data")
```

### Testing

```vague
// Use memory for tests
store testData: memory("test")
```

### Production

```vague
// Use PostgREST for production
store data: postgrest("items")
```

A `postgrest` store needs connection options that aren't expressed in the DSL. See
[PostgREST store](./postgrest) for how to wire them up.

## Exporting data

### Via the CLI

```bash
reqon mission.reqon --output ./output.json
```

This writes a single JSON file containing every store's contents, keyed by store name:

```json
{
  "customers": [ /* ... */ ],
  "orders": [ /* ... */ ],
  "products": [ /* ... */ ]
}
```

### Programmatically

```typescript
import { execute } from 'reqon';

const result = await execute(source);

for (const [name, store] of result.stores) {
  const items = await store.list();
  console.log(`${name}: ${items.length} items`);
}
```

## Custom and production stores

There's no `--store-config` flag. To use a PostgREST store or a custom backend, supply
a configured adapter at runtime through the `stores` option, keyed by the store name
from the mission:

```typescript
import { createStore, fromFile } from 'reqon';

const data = createStore({
  type: 'postgrest',
  name: 'items',
  postgrest: { url: 'https://project.supabase.co/rest/v1', apiKey: 'your-anon-key' },
});

await fromFile('mission.reqon', { stores: { data } });
```

See [PostgREST store](./postgrest) and [Custom adapters](./custom-adapters) for details.

## Best practices

### Use descriptive names

```vague
// Good
store activeCustomers: file("active-customers")
store pendingInvoices: file("pending-invoices")

// Avoid
store data1: file("data1")
store temp: file("temp")
```

### Provide stable keys

```vague
// Good: explicit key
store response -> items { key: .id }

// Relies on record.id, and throws if it's missing
store response -> items
```

### Use upsert for syncs

```vague
// For incremental syncs
store response -> items { key: .id, upsert: true }
```

### Match the adapter to the use case

| Use case | Recommended |
|----------|-------------|
| Unit tests | `memory` |
| Local dev | `file` |
| CI/CD | `file` or `memory` |
| Production | `postgrest` |

## Custom adapters

See [Custom adapters](./custom-adapters) for implementing your own store adapter.
</content>
