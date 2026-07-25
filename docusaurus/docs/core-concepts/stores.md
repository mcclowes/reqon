---
sidebar_position: 4
---

# Stores

A **Store** is a named data persistence target. Stores allow you to save, retrieve, update, and query data during mission execution.

## Basic syntax

```vague
store storeName: adapter("identifier")
```

## Available adapters

| Adapter | Description | Use Case |
|---------|-------------|----------|
| `memory` | In-memory storage | Testing, temporary data |
| `file` | JSON file storage | Local development, small datasets |
| `postgrest` | PostgREST-backed table | Postgres via a PostgREST endpoint |
| `sql` | SQL store (PostgREST under the hood) | See SQL store below |
| `nosql` | NoSQL placeholder | Not yet implemented |

## Memory store

In-memory storage that doesn't persist between runs:

```vague
store cache: memory("cache")
store tempData: memory("temp")
```

Best for:
- Testing
- Temporary processing data
- Intermediate results

## File store

JSON file storage in the `.reqon-data` directory:

```vague
store customers: file("customers")
store orders: file("orders")
```

Creates files like:
```
.reqon-data/
├── customers.json
└── orders.json
```

Best for:
- Local development
- Small to medium datasets
- Simple persistence without database setup

## PostgREST store

Persist to a Postgres table through a PostgREST endpoint:

```vague
store customers: postgrest("customers")
store orders: postgrest("orders")
```

This is the production-ready database adapter. See [PostgREST Store](../stores/postgrest) for connection options.

## SQL and NoSQL stores

`sql` and `nosql` are placeholders rather than full database adapters. There's no MongoDB or DynamoDB support.

```vague
store customers: sql("customers_table")
store events: nosql("events")
```

In `--dev` mode, both fall back to local JSON files. Outside dev mode, a `sql` store needs PostgREST configuration (use `postgrest` directly), and `nosql` errors loudly because it isn't implemented. For real database persistence, use the `postgrest` adapter.

## Store operations

### Writing data

```vague
action SaveData {
  get "/users"

  // Store entire response
  store response -> users

  // Store with key for indexed access
  store response -> users { key: .id }

  // Store nested data
  store response.data.items -> items { key: .itemId }
}
```

### Key option

The `key` option specifies which field to use as the unique identifier:

```vague
store response -> users { key: .id }
store response -> users { key: .email }
store response -> users { key: .orgId + "-" + .userId }
```

### Upsert mode

Insert or update based on key:

```vague
store response -> users {
  key: .id,
  upsert: true
}
```

### Partial updates

Update only provided fields:

```vague
store response -> users {
  key: .id,
  partial: true
}
```

## Reading from stores

Stores are available as variables in actions:

```vague
action ProcessStoredData {
  // Iterate over store contents
  for user in users {
    // Access user data
    get "/orders?userId=" + user.id
  }

  // With filtering
  for user in users where .status == "active" {
    // Process active users only
  }
}
```

## Store interface

Stores implement this interface:

```typescript
interface StoreAdapter {
  // Get single record by key
  get(key: string): Promise<Record | null>

  // Set record with key
  set(key: string, value: Record): Promise<void>

  // Update record (partial)
  update(key: string, partial: Record): Promise<void>

  // Delete record
  delete(key: string): Promise<void>

  // List all records with optional filter
  list(filter?: FilterOptions): Promise<Record[]>

  // Clear all records
  clear(): Promise<void>
}
```

## Filtering store data

Use `where` clauses when iterating:

```vague
action ProcessFiltered {
  // Status filter
  for order in orders where .status == "pending" {
    // Process pending orders
  }

  // Multiple conditions
  for user in users where .active == true and .role == "admin" {
    // Process active admins
  }

  // Comparison
  for product in products where .price > 100 {
    // Process expensive products
  }
}
```

## Checking store contents

`validate` takes a target expression, and `match` arms route on schema name or `_`:

```vague
action CheckStore {
  // Fail the mission if the store is empty
  validate users {
    assume length(users) > 0
  }
}
```

## Cross-store operations

Reference multiple stores:

```vague
action Reconcile {
  for order in orders {
    // Look up related customer
    for customer in customers where .id == order.customerId {
      map order -> EnrichedOrder {
        id: order.id,
        amount: order.amount,
        customerName: customer.name,
        customerEmail: customer.email
      }
      store order -> enrichedOrders { key: .id }
    }
  }
}
```

## Best practices

### Use appropriate adapters

```vague
// Development
store data: file("data")

// Production
store data: postgrest("data_table")
```

### Always specify keys

```vague
// Good: explicit key
store response -> users { key: .id }

// Avoid: no key. Without one, the store falls back to each record's
// `id` field and throws if that's missing - nothing is auto-generated.
store response -> users
```

### Use upsert for sync operations

```vague
action IncrementalSync {
  get "/users" { since: lastSync }

  for user in response {
    store user -> users { key: .id, upsert: true }
  }
}
```

### Clean up temporary stores

```vague
mission CleanPipeline {
  store temp: memory("temp")

  action Process {
    // Use temp store
  }

  // Temp store is automatically cleaned when mission ends
}
```

### Use descriptive store names

```vague
// Good
store activeCustomers: file("active-customers")
store pendingOrders: file("pending-orders")
store syncedInvoices: file("synced-invoices")

// Avoid
store data: file("data")
store temp: file("temp")
```

## Exporting store data

Use the CLI to export stores after execution. `--output` writes a single combined JSON file keyed by store name:

```bash
reqon mission.vague --output ./export.json
```

Or programmatically:

```typescript
const result = await execute(source);

for (const [name, store] of result.stores) {
  const data = await store.list();
  fs.writeFileSync(`${name}.json`, JSON.stringify(data, null, 2));
}
```
