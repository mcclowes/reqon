---
sidebar_position: 1
---

# Store adapters overview

Store adapters provide pluggable backends for data persistence. Reqon includes several built-in adapters and supports custom implementations.

## Available adapters

| Adapter | Description | Best For |
|---------|-------------|----------|
| `memory` | In-memory hash map | Testing, temporary data |
| `file` | JSON file storage | Local development |
| `sql` | SQL database (via PostgREST) | Production with PostgreSQL |
| `nosql` | NoSQL database | MongoDB, DynamoDB |

## Quick start

```vague
mission DataSync {
  // Define stores
  store cache: memory("cache")
  store data: file("my-data")
  store production: sql("items_table")

  action Process {
    get "/items"

    // Write to store
    store response -> data { key: .id }
  }
}
```

## Store interface

All adapters implement this interface:

```typescript
interface StoreAdapter {
  // Read
  get(key: string): Promise<Record | null>
  list(filter?: FilterOptions): Promise<Record[]>

  // Write
  set(key: string, value: Record): Promise<void>
  update(key: string, partial: Record): Promise<void>

  // Delete
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

## Writing data

### Basic store

```vague
store response -> myStore
```

### With key

```vague
store response -> myStore { key: .id }
```

### Upsert mode

Insert or update based on key:

```vague
store response -> myStore { key: .id, upsert: true }
```

### Partial update

Update only specified fields:

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

## Store operations

### Check existence

```vague
match myStore {
  [] -> abort "Store is empty",
  _ -> continue
}
```

### Count items

```vague
validate {
  assume length(myStore) > 0
}
```

### Cross-store operations

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
// Use SQL/NoSQL for production
store data: sql("items")
```

## Environment-based selection

```vague
mission AdaptiveSync {
  // Choose adapter based on environment
  store data: match env("NODE_ENV") {
    "production" => sql("items"),
    "staging" => sql("items_staging"),
    _ => file("items-dev")
  }
}
```

## Store configuration

### Via CLI

```bash
reqon mission.vague --store-config ./stores.json
```

### Configuration file

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://project.supabase.co/rest/v1",
    "apiKey": "your-anon-key"
  },
  "nosql": {
    "type": "mongodb",
    "url": "mongodb://localhost:27017",
    "database": "reqon"
  }
}
```

## Exporting data

### Via CLI

```bash
reqon mission.vague --output ./exports/
```

Creates JSON files:
```
exports/
├── customers.json
├── orders.json
└── products.json
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

### Always specify keys

```vague
// Good: explicit key
store response -> items { key: .id }

// Risky: auto-generated keys
store response -> items
```

### Use upsert for syncs

```vague
// For incremental syncs
store response -> items { key: .id, upsert: true }
```

### Match adapter to use case

| Use Case | Recommended |
|----------|-------------|
| Unit tests | `memory` |
| Local dev | `file` |
| CI/CD | `file` or `memory` |
| Staging | `sql` (separate DB) |
| Production | `sql` or `nosql` |

## Custom adapters

See [Custom Adapters](./custom-adapters) for implementing your own store adapter.
