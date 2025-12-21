# Database Sync Example

Demonstrates Reqon's multiple store types for comprehensive data synchronization.

## Key Features

| Feature | Description |
|---------|-------------|
| `sql()` | Relational database storage |
| `nosql()` | Document database storage |
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
# Run the sync
node dist/cli.js examples/database-sync/sync.vague --verbose

# With database connection string
DATABASE_URL=postgres://... node dist/cli.js examples/database-sync/sync.vague
```

## Configuration

Database connections are configured via environment variables:

```bash
# SQL databases
DATABASE_URL=postgres://user:pass@host:5432/db
MYSQL_URL=mysql://user:pass@host:3306/db

# NoSQL databases
MONGODB_URL=mongodb://host:27017/db
REDIS_URL=redis://host:6379

# File storage
FILE_STORAGE_PATH=/path/to/storage
```

## Best Practices

1. **Use SQL for relational data**: Products, categories, transactions
2. **Use NoSQL for flexible data**: User preferences, metadata, logs
3. **Use memory for processing**: Queues, temporary aggregations
4. **Use file for exports**: Reports, backups, data exchange
5. **Always specify keys**: Ensures idempotent operations
6. **Use upsert for sync**: Handles both creates and updates
7. **Use partial for efficiency**: Only update changed fields
