# Incremental Sync Example

Demonstrates Reqon's incremental sync capabilities for efficient data synchronization.

## Key Features

| Feature | Description |
|---------|-------------|
| `since: lastSync` | Automatically track and use last sync timestamp |
| `sinceParam` | Customize the API parameter name |
| `sinceFormat` | Support multiple date formats (iso, unix, unix-ms, date-only) |
| Checkpoint management | Automatic persistence of sync state |
| Soft delete handling | Track deleted records without data loss |

## How Incremental Sync Works

1. **First Run**: No checkpoint exists, fetches all records
2. **Subsequent Runs**: Uses stored checkpoint to fetch only modified records
3. **On Success**: Checkpoint is updated to current timestamp
4. **On Failure**: Checkpoint remains unchanged, next run retries from same point

## Date Formats

```vague
sinceFormat: "iso"        // 2024-01-15T10:30:00Z
sinceFormat: "unix"       // 1705315800
sinceFormat: "unix-ms"    // 1705315800000
sinceFormat: "date-only"  // 2024-01-15
```

## Usage

```bash
# First run - fetches all data
node dist/cli.js examples/incremental-sync/sync.vague --verbose

# Subsequent runs - only fetches changes
node dist/cli.js examples/incremental-sync/sync.vague --verbose

# Reset checkpoint (full resync)
node dist/cli.js examples/incremental-sync/sync.vague --reset-checkpoints
```

## Checkpoint Storage

Checkpoints are stored per-action in the configured sync store:
- `SyncCustomers` -> last successful sync timestamp
- `SyncContacts` -> last successful sync timestamp
- `SyncDeleted` -> last successful sync timestamp

## Best Practices

1. **Always handle deletes**: APIs often have separate endpoints for deleted records
2. **Use appropriate date format**: Match what your API expects
3. **Set reasonable page sizes**: Balance between API limits and efficiency
4. **Handle timezone correctly**: Most APIs expect UTC timestamps
