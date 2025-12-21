---
sidebar_position: 1
---

# Store Adapters Overview

Store adapters provide pluggable backends for data persistence. Reqon includes several built-in adapters and supports custom implementations.

## Available Adapters

| Adapter | Description | Best For |
|---------|-------------|----------|
| `memory` | In-memory hash map | Testing, temporary data |
| `file` | JSON file storage | Local development |
| `sql` | SQL database (via PostgREST) | Production with PostgreSQL |
| `nosql` | NoSQL database | MongoDB, DynamoDB |

## Quick Start

```reqon
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

## Store Interface

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

## Writing Data

### Basic Store

```reqon
store response -> myStore
```

### With Key

```reqon
store response -> myStore { key: .id }
```

### Upsert Mode

Insert or update based on key:

```reqon
store response -> myStore { key: .id, upsert: true }
```

### Partial Update

Update only specified fields:

```reqon
store response -> myStore { key: .id, partial: true }
```

## Reading Data

### In For Loops

```reqon
for item in myStore {
  // Process each item
}
```

### With Filtering

```reqon
for item in myStore where .status == "active" {
  // Process active items
}
```

### Multiple Conditions

```reqon
for item in myStore where .status == "pending" and .priority > 5 {
  // Process high-priority pending items
}
```

## Store Operations

### Check Existence

```reqon
match myStore {
  [] -> abort "Store is empty",
  _ -> continue
}
```

### Count Items

```reqon
validate {
  assume length(myStore) > 0
}
```

### Cross-Store Operations

```reqon
for order in orders {
  for customer in customers where .id == order.customerId {
    // Join data from multiple stores
  }
}
```

## Choosing an Adapter

### Development

```reqon
// Use file for local development
store data: file("my-data")
```

### Testing

```reqon
// Use memory for tests
store testData: memory("test")
```

### Production

```reqon
// Use SQL/NoSQL for production
store data: sql("items")
```

## Environment-Based Selection

```reqon
mission AdaptiveSync {
  // Choose adapter based on environment
  store data: match env("NODE_ENV") {
    "production" => sql("items"),
    "staging" => sql("items_staging"),
    _ => file("items-dev")
  }
}
```

## Store Configuration

### Via CLI

```bash
reqon mission.reqon --store-config ./stores.json
```

### Configuration File

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

## Exporting Data

### Via CLI

```bash
reqon mission.reqon --output ./exports/
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

## Best Practices

### Use Descriptive Names

```reqon
// Good
store activeCustomers: file("active-customers")
store pendingInvoices: file("pending-invoices")

// Avoid
store data1: file("data1")
store temp: file("temp")
```

### Always Specify Keys

```reqon
// Good: explicit key
store response -> items { key: .id }

// Risky: auto-generated keys
store response -> items
```

### Use Upsert for Syncs

```reqon
// For incremental syncs
store response -> items { key: .id, upsert: true }
```

### Match Adapter to Use Case

| Use Case | Recommended |
|----------|-------------|
| Unit tests | `memory` |
| Local dev | `file` |
| CI/CD | `file` or `memory` |
| Staging | `sql` (separate DB) |
| Production | `sql` or `nosql` |

## Custom Adapters

See [Custom Adapters](./custom-adapters) for implementing your own store adapter.
