# Database Sync Example

Demonstrates Reqon's multiple store types for comprehensive data synchronization.

> **Run this one with `--dev`.** `sql()` and `nosql()` have no database adapter
> behind them: `sql()` works only with a PostgREST backend configured, `nosql()`
> has no implementation at all, and both throw unless `--dev` opts into the local
> JSON file fallback. This example is a shape demo, not a working database sync —
> for real database storage see [postgrest-sync](../postgrest-sync/).

## Key Features

| Feature | Description |
|---------|-------------|
| `sql()` | Relational storage *shape* — no adapter; falls back to JSON files under `--dev` |
| `nosql()` | Document storage *shape* — not implemented; falls back to JSON files under `--dev` |
| `memory()` | Temporary in-memory storage |
| `file()` | File-based storage/export |
| `upsert: true` | Update or insert semantics |
| `partial: true` | Partial record updates |

## Store Types

### SQL Store
For structured, relational data with defined schemas:

```vague
store products: sql("products")
store categories: sql("categories")

// Usage
store response -> products {
  key: .id,
  upsert: true
}
```

### NoSQL Store
For flexible, document-based data:

```vague
store product_details: nosql("product_details")
store reviews: nosql("product_reviews")

// Usage - can store nested objects directly
store {
  product_id: .id,
  metadata: {
    brand: .brand,
    specs: .specifications,
    custom: .attributes
  }
} -> product_details { key: .product_id }
```

### Memory Store
For temporary processing data:

```vague
store queue: memory("processing_queue")
store errors: memory("sync_errors")

// Data persists only during mission execution
```

### File Store
For exports and file-based persistence:

```vague
store catalog: file("catalog_export")

// Writes to file system
store data -> catalog { key: .sku }
```

## Store Operations

### Upsert (Update or Insert)
```vague
store product -> products {
  key: .id,
  upsert: true  // Update if key exists, insert otherwise
}
```

### Partial Updates
```vague
store {
  id: .id,
  price: .new_price
  // Only updates price, keeps other fields
} -> products {
  key: .id,
  partial: true
}
```

### Querying Stores
```vague
// Get by key
let product = products[product_id]

// Filter
let active = products where .status == "active"

// Aggregate
let total = sum(inventory.quantity)
let count = length(products)
```

### Cross-Store Operations
```vague
// Join data from multiple stores
for product in products {
  let details = product_details[product.id]
  let inv = inventory where .product_id == product.id

  store {
    product: product,
    details: details,
    stock: sum(inv.available)
  } -> combined { key: product.id }
}
```

## Usage

```bash
# Run the sync. --dev is required: without it the sql/nosql stores throw.
node dist/cli.js examples/database-sync/sync.vague --dev --verbose
```

Under `--dev`, `sql()` writes to `.reqon-data/sql/` and `nosql()` to
`.reqon-data/nosql/`.

## Configuration

There are no `DATABASE_URL`/`MYSQL_URL`/`MONGODB_URL` style connection strings —
Reqon reads none of them. The only store backend that talks to a real database is
`postgrest()`, configured through PostgREST/Supabase options. See
[postgrest-sync](../postgrest-sync/).

## Best Practices

1. **Use postgrest for real persistence**: it's the only database-backed adapter
2. **Use memory for processing**: Queues, temporary aggregations
3. **Use file for exports**: Reports, backups, data exchange
4. **Always specify keys**: Ensures idempotent operations
5. **Use upsert for sync**: Handles both creates and updates
6. **Use partial for efficiency**: Only update changed fields

The `sql`/`nosql` split above is a modelling exercise. Until those adapters
exist, treat them as file stores with a label.
