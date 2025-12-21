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
| `sql` | SQL database | Production with PostgreSQL/MySQL |
| `nosql` | NoSQL database | Production with MongoDB/DynamoDB |

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

JSON file storage in the `.vague-data` directory:

```vague
store customers: file("customers")
store orders: file("orders")
```

Creates files like:
```
.vague-data/
├── customers.json
└── orders.json
```

Best for:
- Local development
- Small to medium datasets
- Simple persistence without database setup

## SQL store

SQL database storage via PostgREST or direct connection:

```vague
store customers: sql("customers_table")
store orders: sql("orders")
```

Requires configuration:

```json
{
  "stores": {
    "sql": {
      "type": "postgrest",
      "url": "https://your-project.supabase.co/rest/v1",
      "apiKey": "your-anon-key"
    }
  }
}
```

See [PostgREST Store](../stores/postgrest) for details.

## NoSQL store

NoSQL database storage:

```vague
store events: nosql("events_collection")
store logs: nosql("activity_logs")
```

Currently falls back to file storage in development. Full MongoDB/DynamoDB support planned.

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
store response -> users { key: concat(.orgId, "-", .userId) }
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
    get "/orders" { params: { userId: user.id } }
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

## Store aggregations

Access store metadata:

```vague
action CheckStore {
  // Get count
  validate {
    assume length(users) > 0
  }

  // Check if empty
  match users {
    [] -> abort "No users found",
    _ -> continue
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
store data: sql("data_table")
```

### Always specify keys

```vague
// Good: explicit key
store response -> users { key: .id }

// Avoid: no key (uses auto-generated)
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

Use the CLI to export stores after execution:

```bash
reqon mission.vague --output ./exports/
```

Or programmatically:

```typescript
const result = await execute(source);

for (const [name, store] of result.stores) {
  const data = await store.list();
  fs.writeFileSync(`${name}.json`, JSON.stringify(data, null, 2));
}
```
