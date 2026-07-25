---
sidebar_position: 4
---

# Incremental sync

Incremental sync lets you fetch only what's changed since the last run, reducing API calls and keeping your data current.

## Basic usage

```vague
get "/items" {
  since: lastSync
}
```

This automatically:

1. Looks up when the last successful sync occurred.
2. Adds a `since` query parameter to the request.
3. Records a new checkpoint after the action completes.

## How it works

### First run

On the first run there's no checkpoint yet, so Reqon syncs from the Unix epoch:

```
GET /items?since=1970-01-01T00:00:00.000Z
```

### Subsequent runs

On later runs, the last sync timestamp is used:

```
GET /items?since=2024-01-20T10:30:00.000Z
```

The parameter name defaults to `since` and the format defaults to ISO 8601. Both are configurable (see below).

### Checkpoint storage

By default, checkpoints are stored in a per-mission file under `.reqon-data/sync/`:

```
.reqon-data/
└── sync/
    └── MyMission.json
```

When you run with a durable execution log, sync is a view over that log instead: `lastSync` is resolved from the recorded `checkpoint.advanced` events, and there's no separate sync file.

## Configuration

The `since: lastSync` form accepts an optional checkpoint key and an optional config block. There are no separate `sinceParam`, `sinceFormat`, or `syncKey` fetch options.

### Custom parameter name

Tell Reqon which query parameter the API expects:

```vague
get "/items" {
  since: lastSync { param: "modified_since" }
}
```

Generates: `?modified_since=2024-01-20T10:30:00.000Z`

### Send as a header instead

Use a request header rather than a query parameter (mutually exclusive with `param`):

```vague
get "/items" {
  since: lastSync { header: "If-Modified-Since" }
}
```

### Date format

Customise the format of the timestamp. The format is an unquoted identifier:

```vague
get "/items" {
  since: lastSync { param: "updatedAfter", format: unix }
}
```

Supported formats:

- `iso` — ISO 8601 (default): `2024-01-20T10:30:00.000Z`
- `unix` — Unix timestamp in seconds: `1705748400`
- `unix-ms` — Unix timestamp in milliseconds: `1705748400000`
- `date-only` — date portion only: `2024-01-20`

### Custom checkpoint key

Override the automatic checkpoint key (which defaults to `source:endpoint`):

```vague
get "/items" {
  since: lastSync("items-main-sync")
}
```

### Advancing from a response field

By default the checkpoint advances to the sync time. To instead take the new watermark from a field in the response, use `updateFrom`:

```vague
get "/items" {
  since: lastSync { param: "modified_since", updateFrom: "meta.lastModified" }
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

There's no `params` option, so put any extra query parameters directly in the path. The `since` value is appended to whatever you provide:

```vague
get "/items?status=active&type=order" {
  since: lastSync
}
```

## Handling updates

Use upsert mode so re-synced records overwrite their previous version:

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

Different sources maintain separate checkpoints, because the checkpoint key includes the source name:

```vague
mission MultiSourceSync {
  source Xero { auth: oauth2, base: "https://api.xero.com" }
  source QuickBooks { auth: oauth2, base: "https://quickbooks.api.com" }

  action SyncXero {
    get "/invoices" { source: Xero, since: lastSync }
    // Uses an Xero-specific checkpoint
  }

  action SyncQuickBooks {
    get "/invoices" { source: QuickBooks, since: lastSync }
    // Uses a QuickBooks-specific checkpoint
  }
}
```

## Per-endpoint checkpoints

Each endpoint maintains its own checkpoint:

```vague
action SyncAll {
  get "/customers" { since: lastSync }
  // Checkpoint key: source:/customers

  get "/orders" { since: lastSync }
  // Checkpoint key: source:/orders

  get "/products" { since: lastSync }
  // Checkpoint key: source:/products
}
```

## Resetting checkpoints

### Via the file system

Checkpoints live in `.reqon-data/sync/{mission}.json`. Delete the file to force a full resync:

```bash
# Reset all checkpoints for a mission
rm .reqon-data/sync/MyMission.json

# Then run a full sync
reqon sync.reqon
```

### Programmatically

Use a `FileSyncStore`, which exposes `clear(key)` and `clearAll()`:

```typescript
import { FileSyncStore } from 'reqon';

const sync = new FileSyncStore('MyMission');

// Clear every checkpoint for the mission
await sync.clearAll();

// Or clear a single checkpoint by key
await sync.clear('API:/items');
```

## Full sync vs incremental

### Force a full sync

Omit `since` to fetch everything:

```vague
action FullSync {
  get "/items"  // No since option = full sync
  store response -> items { key: .id, upsert: true }
}

action IncrementalSync {
  get "/items" { since: lastSync }
  store response -> items { key: .id, upsert: true }
}
```

## Handling deletions

Incremental sync only sees records the API returns, so it won't notice items deleted upstream. How you reconcile deletions depends on your API. Two common shapes:

- **Soft deletes.** If the API includes deleted records (often behind a flag) and returns them in the changed set, sync them like any other record and let a `deleted` field on the stored record mark their state.
- **A separate deletions feed.** If the API exposes a deletions endpoint, sync it alongside the main feed in a parallel stage:

```vague
action SyncItems {
  get "/items" { since: lastSync }
  store response -> items { key: .id, upsert: true }
}

action SyncDeletions {
  get "/items/deleted" { since: lastSync }
  store response.deletions -> deletions { key: .id, upsert: true }
}

run [SyncItems, SyncDeletions]
```

## Best practices

### Always use upsert

```vague
// Good: handles both new and updated items
store item -> items { key: .id, upsert: true }

// Risky: may fail on records already present
store item -> items { key: .id }
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

Checkpoints only advance once an action completes. If it aborts partway through, the checkpoint stays where it was, so the next run picks up from the same point.

### Wrong date format

Match your API's expected format with the `format` option:

```vague
// For APIs expecting ISO 8601 (default)
get "/items" { since: lastSync }

// For APIs expecting a Unix timestamp
get "/items" { since: lastSync { format: unix } }

// For APIs expecting a date only
get "/items" { since: lastSync { format: date-only } }
```

### Missing updates

Make sure the parameter name matches what the API filters on:

```vague
// If the API expects an "updatedAfter" parameter
get "/items" { since: lastSync { param: "updatedAfter" } }

// If the API expects a "modifiedSince" parameter
get "/items" { since: lastSync { param: "modifiedSince" } }
```
