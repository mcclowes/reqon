---
sidebar_position: 3
---

# Time-travel debugging

Trace recording captures complete execution state at each step, enabling post-execution debugging through replay.

## Basic usage

Enable tracing at the mission level:

```vague
mission DebuggablePipeline {
  trace: full

  action Process {
    get "/data"
    store response -> data { key: .id }
    for item in data {
      map item -> Processed {
        // field mappings omitted
      }
    }
  }

  run Process
}
```

## Trace modes

### full

Captures complete state snapshots:

```vague
mission FullTrace {
  trace: full

  action Process {
    // Every step captures: variables, response, store state
  }

  run Process
}
```

Captures:
- All variable values
- Current `response`
- Store snapshots
- Loop context and iteration state
- Step timing information

### minimal

Captures lightweight state markers:

```vague
mission MinimalTrace {
  trace: minimal

  action Process {
    // Captures step transitions, not full state
  }

  run Process
}
```

Captures:
- Step type and name
- Timestamps
- Errors (if any)
- Basic flow information

## Trace snapshots

### What's captured

Each trace snapshot includes:

| Field | Description |
|-------|-------------|
| `id` | Unique snapshot ID |
| `index` | Sequential snapshot number |
| `timestamp` | When the snapshot was taken |
| `mission` | Mission name |
| `action` | Current action name |
| `stepIndex` | Step index within action |
| `stepType` | Type of step (fetch, store, map, etc.) |
| `phase` | `before` or `after` the step |
| `variables` | All variable values |
| `stores` | Store state (keys/counts) |
| `stepDuration` | Execution time (after phase only) |

### Snapshot phases

Each step generates two snapshots:

```
Step 1: get "/data"
  → Snapshot (before): variables = { page: 1 }
  → Snapshot (after): variables = { page: 1 }, response = {...}

Step 2: store response -> data
  → Snapshot (before): response = {...}
  → Snapshot (after): stores = { data: { count: 100 } }
```

## Using the trace replayer

### Loading a trace

```typescript
import { TraceReplayer, FileTraceStore } from 'reqon-dsl';

const store = new FileTraceStore('.reqon-data/traces');
const replayer = new TraceReplayer(store);

// Load trace by execution ID
const session = await replayer.loadTrace('exec-abc123');

console.log(session.totalSnapshots);  // 42
console.log(session.currentIndex);    // 0
```

### Navigating snapshots

```typescript
// Step forward
const next = await replayer.next();
console.log(next.snapshot.stepType);  // 'fetch'
console.log(next.hasNext);            // true

// Step backward
const prev = await replayer.previous();

// Jump to specific snapshot
const result = await replayer.goToStep(10);
console.log(result.snapshot.variables);

// Jump to action
await replayer.goToAction('ProcessData');
```

### Comparing snapshots

```typescript
// See what changed between two snapshots
const diff = replayer.compareSnapshots(5, 6);

console.log(diff.variableChanges);
// [
//   { name: 'response', type: 'added', newValue: {...} },
//   { name: 'page', type: 'modified', oldValue: 1, newValue: 2 }
// ]

console.log(diff.storeChanges);
// [
//   { store: 'data', type: 'modified', itemsAdded: 100 }
// ]
```

### Timeline view

```typescript
// Get execution timeline
const timeline = replayer.getTimeline();

for (const event of timeline) {
  console.log(`${event.timestamp}: ${event.type} - ${event.action}`);
}
// 2024-01-20T09:00:00: action-start - FetchData
// 2024-01-20T09:00:01: step-complete - fetch
// 2024-01-20T09:00:02: step-complete - store
// 2024-01-20T09:00:02: action-complete - FetchData
```

## Trace storage

### File storage (default)

```
.reqon-data/traces/
├── exec-abc123/
│   ├── meta.json          # Trace metadata
│   └── snapshots/
│       ├── 000000.json    # First snapshot
│       ├── 000001.json
│       └── ...
└── exec-def456/
    └── ...
```

### Memory storage

For testing or ephemeral traces:

```typescript
import { MemoryTraceStore, TraceRecorder } from 'reqon-dsl';

const store = new MemoryTraceStore();
const recorder = new TraceRecorder({ store, mode: 'full' });
```

## Use cases

### Debugging failed executions

```vague
mission DataPipeline {
  trace: full

  action Process {
    get "/data"
    for item in response.items {
      validate item {
        assume .amount > 0  // Might fail
      }
    }
  }

  run Process
}
```

When validation fails, replay the trace:

```typescript
const replayer = new TraceReplayer(store);
await replayer.loadTrace('exec-failed');

// Find the failure point
const timeline = replayer.getTimeline();
const failure = timeline.find(e => e.type === 'error');

// Go to the step before the failure
const result = await replayer.goToStep(failure.snapshotIndex - 1);

// Inspect the data that caused the failure
console.log(result.snapshot.variables.item);
```

### Understanding data transformations

```vague
mission TransformPipeline {
  trace: full

  action Transform {
    for item in raw {
      map item -> CleanedItem {
        name: upper(.name),
        amount: .price * .quantity,
        state: .state
      }
    }
  }

  run Transform
}
```

Replay to see input/output at each transformation:

```typescript
const replayer = new TraceReplayer(store);
await replayer.loadTrace('exec-123');

// Find map steps
let step = await replayer.next();
while (step) {
  const snap = step.snapshot;
  if (snap.stepType === 'map') {
    const diff = replayer.compareSnapshots(snap.index - 1, snap.index);
    console.log('Input:', diff.variableChanges.find(v => v.name === 'item')?.oldValue);
    console.log('Output:', diff.variableChanges.find(v => v.name === 'response')?.newValue);
  }
  step = await replayer.next();
}
```

### Performance analysis

```typescript
const replayer = new TraceReplayer(store);
await replayer.loadTrace('exec-123');

const timeline = replayer.getTimeline();
const slowSteps = timeline
  .filter(e => e.type === 'step-complete' && e.duration > 1000)
  .sort((a, b) => b.duration - a.duration);

console.log('Slowest steps:');
for (const step of slowSteps.slice(0, 5)) {
  console.log(`${step.stepType}: ${step.duration}ms`);
}
```

## Data handling

### Truncation

Large data is automatically truncated in traces:

```typescript
import { truncateForTrace } from 'reqon-dsl';

// Arrays > 100 items are truncated
const largeArray = Array.from({ length: 500 }, (_, i) => i);
const truncated = truncateForTrace(largeArray, 100);
// [0, 1, ..., 99, "[truncated: 400 more items]"]

// Strings > 1000 chars are truncated
const longString = 'x'.repeat(5000);
const truncatedStr = truncateForTrace(longString, 100, 1000);
// "xxx...[truncated: 4000 more chars]"
```

### Circular references

Circular references are safely handled:

```typescript
import { safeClone } from 'reqon-dsl';

const obj = { name: 'test' };
obj.self = obj;

const cloned = safeClone(obj);
// { name: 'test', self: '[circular reference]' }
```

## Best practices

1. **Use `full` for debugging** - When you need complete visibility
2. **Use `minimal` for production** - Lower overhead, basic flow tracking
3. **Clean up old traces** - Traces can grow large over time
4. **Combine with checkpoint** - Full durability and debuggability

## Performance impact

| Mode | Storage | CPU | Memory |
|------|---------|-----|--------|
| `full` | ~1KB/step | Moderate | Moderate |
| `minimal` | ~100B/step | Low | Low |
| None | None | None | None |

For production with many executions:

`FileTraceStore` takes a directory path:

```typescript
const store = new FileTraceStore('.reqon-data/traces');
```

It doesn't prune old traces automatically. For production with many executions, delete old trace directories under `.reqon-data/traces/` yourself, or use `MemoryTraceStore` for ephemeral runs.
