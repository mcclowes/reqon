---
sidebar_position: 3
---

# File Store

The file store persists data as JSON files in the `.reqon-data` directory.

## Configuration

```reqon
store customers: file("customers")
store orders: file("orders")
```

Creates:
```
.reqon-data/
├── customers.json
└── orders.json
```

## File Structure

Each store is a single JSON file containing an array of records:

```json
[
  {"id": "1", "name": "Alice", "email": "alice@example.com"},
  {"id": "2", "name": "Bob", "email": "bob@example.com"}
]
```

When using keys:
```json
{
  "1": {"id": "1", "name": "Alice"},
  "2": {"id": "2", "name": "Bob"}
}
```

## Use Cases

### Local Development

```reqon
mission DevSync {
  store data: file("dev-data")

  action Sync {
    get "/items"
    store response -> data { key: .id }
  }
}
```

### Persistent Cache

```reqon
mission CachedSync {
  store cache: file("sync-cache")

  action IncrementalSync {
    get "/items" { since: lastSync }
    store response -> cache { key: .id, upsert: true }
  }
}
```

### Data Export

```reqon
mission ExportData {
  store export: file("export")

  action Export {
    get "/all-data"

    for item in response.data {
      map item -> ExportFormat { /* ... */ }
      store item -> export { key: .id }
    }
  }
}
```

## Custom Directory

```reqon
// Default: .reqon-data/
store data: file("data")

// Custom path (via config)
store data: file("data", { dir: "./custom-dir" })
```

Or via CLI:

```bash
REQON_STATE_DIR=./my-data reqon mission.reqon
```

## Operations

### Write

```reqon
// Simple write
store response -> data { key: .id }

// Upsert (insert or update)
store response -> data { key: .id, upsert: true }

// Partial update
store response -> data { key: .id, partial: true }
```

### Read

```reqon
// Iterate all
for item in data { }

// Filter
for item in data where .status == "active" { }
```

### Delete

```reqon
// Delete by key
delete data[item.id]

// Clear all
clear data
```

## File Locking

File stores use atomic writes to prevent corruption:

1. Write to temporary file
2. Rename to target file (atomic)
3. Delete old file

This ensures data integrity even during crashes.

## Best Practices

### Use Meaningful Names

```reqon
// Good
store activeCustomers: file("active-customers")
store invoiceArchive: file("invoice-archive-2024")

// Avoid
store d: file("d")
```

### Add to .gitignore

```gitignore
# Reqon data directory
.reqon-data/
```

### Use for Development Only

```reqon
mission ConfigurableSync {
  store data: match env("NODE_ENV") {
    "production" => sql("items"),
    _ => file("items-dev")
  }
}
```

### Regular Backups

For important development data:

```bash
# Backup before major changes
cp -r .reqon-data .reqon-data.backup
```

## Size Considerations

File stores work well for:
- Up to ~100MB per file
- Up to ~100,000 records

For larger datasets, consider SQL stores.

### Performance Tips

```reqon
// For large datasets, batch operations
for batch in chunks(items, 1000) {
  for item in batch {
    store item -> data { key: .id }
  }
}
```

## Debugging

### Inspect Files

```bash
# View raw data
cat .reqon-data/customers.json | jq

# Count records
cat .reqon-data/customers.json | jq 'length'
```

### Reset Data

```bash
# Clear specific store
rm .reqon-data/customers.json

# Clear all data
rm -rf .reqon-data/
```

## Comparison

| Aspect | File Store | Memory Store |
|--------|-----------|--------------|
| Persistence | Yes | No |
| Speed | Fast | Fastest |
| Scalability | Medium | Limited |
| Use Case | Development | Testing |
