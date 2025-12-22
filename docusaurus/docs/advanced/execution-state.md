---
sidebar_position: 2
---

# Execution state

Reqon maintains execution state for resumable missions and audit trails.

## State storage

State is stored in `.vague-data/`:

```
.vague-data/
├── execution/
│   ├── CustomerSync-2024-01-20T09-00-00.json
│   └── CustomerSync-2024-01-20T10-00-00.json
├── sync-checkpoints.json
└── stores/
```

## Execution record

Each execution creates a record:

```json
{
  "executionId": "exec_abc123",
  "mission": "CustomerSync",
  "startedAt": "2024-01-20T09:00:00Z",
  "completedAt": "2024-01-20T09:02:30Z",
  "status": "completed",
  "actionsRun": ["FetchCustomers", "TransformCustomers"],
  "errors": [],
  "stores": {
    "customers": {
      "count": 1523,
      "added": 42,
      "updated": 18
    }
  }
}
```

## State fields

| Field | Description |
|-------|-------------|
| `executionId` | Unique execution identifier |
| `mission` | Mission name |
| `startedAt` | Start timestamp |
| `completedAt` | Completion timestamp |
| `status` | `running`, `completed`, `failed`, `interrupted` |
| `actionsRun` | Actions that completed |
| `activeStep` | Currently running step (if in progress) |
| `errors` | Array of errors encountered |

## Checkpoints

### Sync checkpoints

Track incremental sync progress:

```json
{
  "API-/customers": {
    "lastSync": "2024-01-20T09:00:00Z",
    "itemsSynced": 1523
  },
  "API-/orders": {
    "lastSync": "2024-01-20T08:45:00Z",
    "itemsSynced": 8721
  }
}
```

### Action checkpoints

Track progress within long-running actions:

```json
{
  "FetchCustomers": {
    "page": 15,
    "itemsProcessed": 1500
  }
}
```

## Resumable execution

### Automatic resume

If a mission is interrupted, Reqon can resume:

```bash
reqon ./missions/ --resume
```

### Resume point detection

```json
{
  "executionId": "exec_abc123",
  "status": "interrupted",
  "activeStep": {
    "action": "TransformCustomers",
    "index": 523,
    "item": { "id": "cust_524" }
  }
}
```

Resume starts from `item 523` in `TransformCustomers`.

## Accessing state

### Programmatically

```typescript
import { execute, getExecutionState } from 'reqon';

// Get last execution
const lastState = await getExecutionState('CustomerSync');

// Get specific execution
const state = await getExecutionState('CustomerSync', 'exec_abc123');

// Get all executions
const history = await getExecutionHistory('CustomerSync', { limit: 10 });
```

### Via CLI

```bash
# Show last execution
reqon status CustomerSync

# Show execution history
reqon history CustomerSync --limit 10

# Show specific execution
reqon status CustomerSync --execution exec_abc123
```

## State cleanup

### Automatic cleanup

```vague
mission CustomerSync {
  stateRetention: 7 days  // Keep 7 days of history
}
```

### Manual cleanup

```bash
# Clear old state
reqon cleanup --older-than 30d

# Clear specific mission
reqon cleanup CustomerSync --all
```

## Monitoring

### Execution callbacks

```typescript
import { execute } from 'reqon';

const result = await execute(source, {
  progressCallbacks: {
    onActionStart: (action) => {
      console.log(`Starting: ${action}`);
    },
    onActionComplete: (action, duration) => {
      console.log(`Completed: ${action} in ${duration}ms`);
    },
    onError: (error) => {
      console.error(`Error: ${error.message}`);
    },
    onProgress: (progress) => {
      console.log(`Progress: ${progress.current}/${progress.total}`);
    }
  }
});
```

### Metrics export

```bash
reqon ./missions/ --daemon --metrics-port 9090
```

Exposes Prometheus metrics:

```
reqon_execution_duration_seconds{mission="CustomerSync"}
reqon_execution_items_processed{mission="CustomerSync"}
reqon_execution_errors_total{mission="CustomerSync"}
```

## State persistence

### File-based (default)

```vague
mission CustomerSync {
  stateStore: file  // Default
}
```

### Custom state store

```typescript
import { execute, setStateStore } from 'reqon';

setStateStore({
  async save(state) {
    await database.insert('execution_state', state);
  },
  async load(executionId) {
    return database.findOne('execution_state', { executionId });
  }
});
```

## Best practices

### Enable for long-running missions

```vague
mission LongSync {
  enableState: true
  stateRetention: 30 days
}
```

### Use checkpoints for large datasets

```vague
action ProcessLargeDataset {
  for item in items checkpoint every 100 {
    // State saved every 100 items
  }
}
```

### Monitor execution health

```bash
# Set up alerting for failed executions
reqon ./missions/ --daemon --alert-on-failure
```

## Troubleshooting

### State not persisting

Check directory permissions:

```bash
ls -la .vague-data/
```

### Resume not working

Verify state file exists:

```bash
cat .vague-data/execution/CustomerSync-*.json | jq '.status'
```

### State too large

Reduce retention or clean up:

```bash
du -sh .vague-data/
reqon cleanup --older-than 7d
```
