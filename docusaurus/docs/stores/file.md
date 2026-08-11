---
sidebar_position: 3
---

# File store

The file store persists data as JSON files in the `.reqon-data` directory.

## Configuration

```vague
store customers: file("customers")
store orders: file("orders")
```

Creates:
```
.reqon-data/
├── customers.json
└── orders.json
```

## File structure

Each store is a single JSON file containing an object keyed by record key:

```json
{
  "1": {"id": "1", "name": "Alice", "email": "alice@example.com"},
  "2": {"id": "2", "name": "Bob", "email": "bob@example.com"}
}
```

The key is the value you pass in `key:`, falling back to `record.id` when you don't.

## Use cases

### Local development

```vague
mission DevSync {
  store data: file("dev-data")

  action Sync {
    get "/items"
    store response -> data { key: .id }
  }
}
```

### Persistent cache

```vague
mission CachedSync {
  store cache: file("sync-cache")

  action IncrementalSync {
    get "/items" { since: lastSync }
    store response -> cache { key: .id, upsert: true }
  }
}
```

### Data export

```vague
mission ExportData {
  store export: file("export")

  action Export {
    get "/all-data"

    for item in response.data {
      map item -> ExportFormat {
        // field mappings omitted
      }
      store item -> export { key: .id }
    }
  }
}
```

## Data directory

File stores write to `.reqon-data/` by default. To change the directory, pass `dataDir` when running programmatically:

```typescript
import { fromFile } from 'reqon-dsl';

await fromFile('mission.reqon', { dataDir: './my-data' });
```

The store name maps to a file inside that directory, so `file("customers")` becomes `<dataDir>/customers.json`.

## Operations

### Write

```vague
// Simple write
store response -> data { key: .id }

// Upsert (insert or update)
store response -> data { key: .id, upsert: true }

// Partial update (deep merge into the existing record, same as upsert)
store response -> data { key: .id, partial: true }
```

### Read

```vague
// Iterate all
for item in data { }

// Filter
for item in data where .status == "active" { }
```

## Atomic writes

File stores write atomically to prevent corruption:

1. Write to a temporary file
2. Rename it over the target file (atomic)

This keeps the file consistent even if the process is interrupted mid-write.

## Best practices

### Use meaningful names

```vague
// Good
store activeCustomers: file("active-customers")
store invoiceArchive: file("invoice-archive-2024")

// Avoid
store d: file("d")
```

### Ignore the data directory in git

The store creates a `.gitignore` inside `.reqon-data/` that ignores its own `*.json` files, so checked-out data won't be committed by accident. You can also ignore the whole directory:

```gitignore
# Reqon local data
.reqon-data/
```

### Use for development only

The file store is for local development. For production storage, use the PostgREST store.

### Regular backups

For important development data:

```bash
# Backup before major changes
cp -r .reqon-data .reqon-data.backup
```

## Size considerations

The whole store is held in memory and rewritten on change, so it works best for
modest datasets. For larger volumes, use the PostgREST store.

## Debugging

### Inspect files

```bash
# View raw data
cat .reqon-data/customers.json | jq

# Count records
cat .reqon-data/customers.json | jq 'length'
```

### Reset data

```bash
# Clear a specific store
rm .reqon-data/customers.json

# Clear all data
rm -rf .reqon-data/
```

## Comparison

| Aspect | File store | Memory store |
|--------|-----------|--------------|
| Persistence | Yes | No |
| Speed | Fast | Fastest |
| Scalability | Medium | Limited |
| Use case | Development | Testing |
