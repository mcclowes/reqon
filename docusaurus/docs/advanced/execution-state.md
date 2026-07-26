---
sidebar_position: 2
---

# Execution state

Reqon can persist execution state so missions can resume after a crash or restart, and so you can inspect what happened on a previous run.

State persistence is opt-in. Pass `persistState: true` (or a custom `executionStore`) to the executor, and Reqon writes an execution record for each run.

## State storage

By default, state lives under `.reqon-data/`:

```
.reqon-data/
├── executions/        # Execution records (one JSON file per run)
├── sync/              # Incremental-sync checkpoints, one per mission
├── traces/            # Trace snapshots (when trace is enabled)
└── pauses/            # Pause state (for long pauses)
```

The base directory is configurable with the `dataDir` option.

## Execution record

Each run produces an `ExecutionState` record:

```json
{
  "id": "exec_abc123",
  "mission": "CustomerSync",
  "status": "completed",
  "startedAt": "2024-01-20T09:00:00Z",
  "completedAt": "2024-01-20T09:02:30Z",
  "duration": 150000,
  "stages": [
    { "action": "FetchCustomers", "status": "completed", "itemsProcessed": 1523, "attempt": 0 },
    { "action": "TransformCustomers", "status": "completed", "attempt": 0 }
  ],
  "errors": []
}
```

## State fields

| Field | Description |
|-------|-------------|
| `id` | Unique execution identifier |
| `mission` | Mission name |
| `status` | `pending`, `running`, `completed`, `failed`, or `paused` |
| `startedAt` | Start timestamp |
| `completedAt` | Completion timestamp (if finished) |
| `duration` | Total duration in milliseconds |
| `stages` | Per-stage state (`action`, `status`, `itemsProcessed`, `attempt`, …) |
| `checkpoint` | Latest checkpoint for resume (if any) |
| `errors` | Errors encountered during the run |
| `metadata` | User-provided context passed via the `metadata` option |

## Checkpoints

### Sync checkpoints

Incremental sync writes a checkpoint per mission to `.reqon-data/sync/{mission}.json`, recording the last sync point so the next run only fetches what changed. See [incremental sync](../http/incremental-sync) for the `since: lastSync` syntax.

### Resume checkpoints

When a run is interrupted, the execution record carries a `checkpoint` describing where to pick up:

```json
{
  "stageIndex": 1,
  "stepIndex": 3,
  "itemIndex": 523,
  "createdAt": "2024-01-20T09:01:00Z"
}
```

`itemIndex` is set when the interruption happened inside a `for` loop, so the resume starts from the next unprocessed item.

## Resumable execution

If a run is interrupted (status `paused` or `failed`), resume it by execution ID:

```bash
reqon ./missions/customer-sync/ --resume exec_abc123
```

When a run pauses or fails, the CLI prints the execution ID and the exact resume command to use.

## Accessing state

### Programmatically

State is read through an execution store, not standalone helper functions:

```typescript
import { FileExecutionStore } from 'reqon';

const store = new FileExecutionStore('.reqon-data/executions');

// Latest run for a mission
const latest = await store.findLatest('CustomerSync');

// A specific run
const state = await store.load('exec_abc123');

// Recent runs
const recent = await store.listRecent(10);

// Runs that can be resumed
const resumable = await store.findResumable('CustomerSync');
```

`MemoryExecutionStore` offers the same interface for tests and ephemeral runs.

### Via the control server

When a mission runs with `--control`, the control server exposes live status:

```bash
curl http://localhost:3001/status
```

## State cleanup

There's no built-in cleanup command. Remove old records directly, or via the store:

```typescript
import { FileExecutionStore } from 'reqon';

const store = new FileExecutionStore('.reqon-data/executions');
await store.delete('exec_abc123');
```

Old files can also be deleted from `.reqon-data/executions/` directly.

## Monitoring

### Progress callbacks

Pass `progress` callbacks to observe a run in real time:

```typescript
import { execute } from 'reqon';

const result = await execute(source, {
  progress: {
    onExecutionStart: (event) => console.log(`Started: ${event.mission}`),
    onStageStart: (event) => console.log(`Stage: ${event.stageName}`),
    onStageComplete: (event) => console.log(`Done: ${event.stageName}`),
    onExecutionComplete: (event) => console.log(`Finished in ${event.duration}ms`),
  },
});
```

For fine-grained, per-step monitoring, use the [observability event system](../observability/overview).

## State persistence

### Enabling persistence

State is only written when you opt in:

```typescript
import { execute } from 'reqon';

const result = await execute(source, {
  persistState: true,   // write execution records under .reqon-data/executions/
  dataDir: '.reqon-data',
});
```

### Custom execution store

Provide your own `executionStore` to persist state somewhere other than the filesystem. Implement the `ExecutionStore` interface (`save`, `load`, `listByMission`, `listRecent`, `delete`, `findLatest`, `findResumable`):

```typescript
import { execute, type ExecutionStore } from 'reqon';

const myStore: ExecutionStore = {
  async save(state) { /* persist to a database */ },
  async load(id) { /* ... */ return null; },
  async listByMission(mission) { return []; },
  async listRecent(limit) { return []; },
  async delete(id) { /* ... */ },
  async findLatest(mission) { return null; },
  async findResumable(mission) { return []; },
};

await execute(source, { executionStore: myStore, persistState: true });
```

## Event log

For replay-based durable execution, Reqon can also emit an append-only event log via the `executionLog` option. Pause, sync, and trace are all views over this log. See [durability](../durability/overview) for details.

## Troubleshooting

### State not persisting

Confirm you passed `persistState: true` (state isn't written otherwise), then check directory permissions:

```bash
ls -la .reqon-data/executions/
```

### Resume not working

Verify the execution record exists and is resumable:

```bash
cat .reqon-data/executions/CustomerSync-*.json | jq '.status'
```

Only runs with status `paused` or `failed` can be resumed.
