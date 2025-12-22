---
sidebar_position: 4
---

# Incremental sync

Incremental sync allows you to fetch only changes since the last run, reducing API calls and improving performance.

## Basic usage

```vague
get "/items" {
  since: lastSync
}
```

This automatically:
1. Checks when the last successful sync occurred
2. Adds a timestamp parameter to the request
3. Updates the checkpoint after successful completion

## How it works

### First run

On the first run, no `since` parameter is added:

```
GET /items
```

### Subsequent runs

On subsequent runs, the last sync timestamp is used:

```
GET /items?modified_since=2024-01-20T10:30:00Z
```

### Checkpoint storage

Checkpoints are stored in `.vague-data/` by default:

```
.vague-data/
├── sync-checkpoints.json
└── stores/
```

## Configuration

### Custom parameter name

Specify the API's expected parameter:

```vague
get "/items" {
  since: lastSync,
  sinceParam: "updatedAfter"
}
```

Generates: `?updatedAfter=2024-01-20T10:30:00Z`

### Date format

Customize the date format:

```vague
get "/items" {
  since: lastSync,
  sinceFormat: "YYYY-MM-DD"
}
```

Common formats:
- `"ISO"` - ISO 8601 (default): `2024-01-20T10:30:00Z`
- `"YYYY-MM-DD"` - Date only: `2024-01-20`
- `"timestamp"` - Unix timestamp: `1705748400`
- `"epoch"` - Unix epoch milliseconds: `1705748400000`

### Custom checkpoint key

Override the automatic checkpoint key:

```vague
get "/items" {
  since: lastSync,
  syncKey: "items-main-sync"
}
```

## Combining with pagination

```vague
get "/items" {
  paginate: offset(offset, 100),
  until: length(response.items) == 0,
  since: lastSync
}
```

The `since` parameter is added to each paginated request.

## Combining with filters

```vague
get "/items" {
  params: {
    status: "active",
    type: "order"
  },
  since: lastSync
}
```

Generates: `?status=active&type=order&modified_since=2024-01-20T10:30:00Z`

## Handling updates

Use upsert mode for incremental updates:

```vague
action IncrementalSync {
  get "/items" {
    paginate: offset(offset, 100),
    until: length(response.items) == 0,
    since: lastSync
  }

  for item in response.items {
    store item -> items { key: .id, upsert: true }
  }
}
```

## Per-source checkpoints

Different sources maintain separate checkpoints:

```vague
mission MultiSourceSync {
  source Xero { auth: oauth2, base: "https://api.xero.com" }
  source QuickBooks { auth: oauth2, base: "https://quickbooks.api.com" }

  action SyncXero {
    get Xero "/invoices" { since: lastSync }
    // Uses Xero-specific checkpoint
  }

  action SyncQuickBooks {
    get QuickBooks "/invoices" { since: lastSync }
    // Uses QuickBooks-specific checkpoint
  }
}
```

## Per-endpoint checkpoints

Each endpoint maintains its own checkpoint:

```vague
action SyncAll {
  get "/customers" { since: lastSync }
  // Checkpoint: source-/customers

  get "/orders" { since: lastSync }
  // Checkpoint: source-/orders

  get "/products" { since: lastSync }
  // Checkpoint: source-/products
}
```

## Resetting checkpoints

### Via CLI

```bash
# Reset all checkpoints
rm -rf .vague-data/sync-checkpoints.json

# Then run a full sync
reqon sync.vague
```

### Programmatically

```typescript
import { execute, clearSyncCheckpoints } from 'reqon';

// Clear all checkpoints
await clearSyncCheckpoints();

// Or clear specific checkpoint
await clearSyncCheckpoint('source-/items');
```

## Full sync vs incremental

### Force full sync

Sometimes you need a full resync:

```vague
action FullSync {
  get "/items"  // No since option = full sync
  store response -> items { key: .id, upsert: true }
}

action IncrementalSync {
  get "/items" { since: lastSync }
  store response -> items { key: .id, upsert: true }
}

// Use conditional in pipeline
run IncrementalSync  // Default: incremental
// Or: run FullSync when needed
```

### Conditional sync

```vague
action SmartSync {
  get "/status"

  match response {
    { needsFullSync: true } -> {
      get "/items"
      store response -> items { key: .id }
    },
    _ -> {
      get "/items" { since: lastSync }
      store response -> items { key: .id, upsert: true }
    }
  }
}
```

## Handling deletions

Incremental sync doesn't automatically handle deleted items. Handle this based on your API:

### Soft deletes

```vague
get "/items" {
  params: { includeDeleted: true },
  since: lastSync
}

for item in response.items {
  match item {
    { deleted: true } -> {
      // Remove from local store
      delete items[item.id]
    },
    _ -> store item -> items { key: .id, upsert: true }
  }
}
```

### Deletion endpoint

```vague
action SyncItems {
  get "/items" { since: lastSync }
  store response -> items { key: .id, upsert: true }
}

action SyncDeletions {
  get "/items/deleted" { since: lastSync }

  for deletion in response.deletions {
    delete items[deletion.id]
  }
}

run [SyncItems, SyncDeletions]
```

## Best practices

### Always use upsert

```vague
// Good: handles both new and updated items
store item -> items { key: .id, upsert: true }

// Risky: may fail on duplicates
store item -> items { key: .id }
```

### Handle empty responses

```vague
get "/items" { since: lastSync }

match response {
  { items: [] } -> {
    // No updates since last sync - this is fine
    continue
  },
  _ -> {
    for item in response.items {
      store item -> items { key: .id, upsert: true }
    }
  }
}
```

### Log sync progress

```vague
action IncrementalSync {
  get "/items" { since: lastSync }

  store {
    timestamp: now(),
    itemCount: length(response.items),
    type: "incremental"
  } -> syncLogs

  for item in response.items {
    store item -> items { key: .id, upsert: true }
  }
}
```

### Schedule regular syncs

```vague
mission RegularSync {
  schedule: every 15 minutes

  action Sync {
    get "/items" { since: lastSync }
    store response -> items { key: .id, upsert: true }
  }

  run Sync
}
```

## Troubleshooting

### Checkpoint not updating

Checkpoints only update on successful completion. Check for errors:

```vague
action DebugSync {
  get "/items" { since: lastSync }

  match response {
    { error: e } -> {
      store { error: e, timestamp: now() } -> syncErrors
      abort e
    },
    _ -> continue
  }

  for item in response.items {
    store item -> items { key: .id, upsert: true }
  }
}
```

### Wrong date format

Match your API's expected format:

```vague
// For APIs expecting ISO 8601
get "/items" { since: lastSync }

// For APIs expecting Unix timestamp
get "/items" { since: lastSync, sinceFormat: "timestamp" }

// For APIs expecting date only
get "/items" { since: lastSync, sinceFormat: "YYYY-MM-DD" }
```

### Missing updates

Ensure your API uses the same field for filtering:

```vague
// If API uses "updatedAt" field
get "/items" { since: lastSync, sinceParam: "updatedAt" }

// If API uses "modifiedSince" parameter
get "/items" { since: lastSync, sinceParam: "modifiedSince" }
```
