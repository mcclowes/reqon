---
sidebar_position: 2
---

# Checkpoint configuration

Checkpoints enable durable execution by saving state at defined points, allowing missions to resume after failures.

## Basic usage

Add a checkpoint configuration at the mission level:

```vague
mission DurableSync {
  checkpoint: afterStep

  action FetchData {
    get "/items"
    store response -> items { key: .id }
  }

  run FetchData
}
```

## Checkpoint modes

### afterStep

Saves state after every step completes successfully:

```vague
mission CriticalPipeline {
  checkpoint: afterStep

  action Process {
    get "/data"           // Checkpoint saved after this
    store response -> data // Checkpoint saved after this
    for item in data {
      post "/process"     // Checkpoint saved after each iteration
    }
  }

  run Process
}
```

Best for: Maximum durability, critical workloads, expensive operations.

### onFailure

Only saves state when a step fails:

```vague
mission EfficientSync {
  checkpoint: onFailure

  action Sync {
    get "/items"
    store response -> items { key: .id }
  }

  run Sync
}
```

Best for: Better performance when failures are rare, less critical workloads.

## How checkpoints work

### State captured

Each checkpoint captures:

| Component | Description |
|-----------|-------------|
| Stage index | Current pipeline stage |
| Step index | Current step within the action |
| Variables | All variable values at that point |
| Response | Current `response` value |
| Store state | References to store contents |
| Loop context | Iterator position if in a loop |

### Resume behavior

When resuming from a checkpoint:

1. Reqon loads the last checkpoint
2. Execution starts from the next step after the checkpoint
3. Variables and context are restored
4. Stores are reconnected (data persists separately)

```bash
# Resume an interrupted mission by its execution ID
reqon mission.vague --resume exec_abc123
```

## Checkpoint storage

### Default storage

The checkpoint lives inside the execution record, under `.reqon-data/executions/`:

```
.reqon-data/executions/
├── SyncMission-2024-01-20T09-00-00.json
└── SyncMission-2024-01-20T10-00-00.json
```

### Checkpoint structure

Each execution record carries the latest checkpoint under its `checkpoint` field:

```json
{
  "id": "exec-abc123",
  "mission": "SyncMission",
  "status": "paused",
  "checkpoint": {
    "stageIndex": 1,
    "stepIndex": 3,
    "itemIndex": 42,
    "variables": { "page": 5 },
    "createdAt": "2024-01-20T09:15:30Z"
  }
}
```

`itemIndex` is present when the run was interrupted inside a `for` loop.

## Use cases

### Large dataset processing

```vague
mission ProcessLargeDataset {
  checkpoint: afterStep

  action FetchAll {
    get "/items" {
      paginate: offset(page, 1000),
      until: length(response) == 0
    }
    store response -> items { key: .id }
  }

  action ProcessAll {
    for item in items {
      post "/process" { body: item }
    }
  }

  run FetchAll then ProcessAll
}
```

If processing fails at item 5000, resume picks up from item 5000.

### Multi-stage pipelines

```vague
mission ETLPipeline {
  checkpoint: afterStep

  action Extract {
    get "/source/data"
    store response -> raw { key: .id }
  }

  action Transform {
    for item in raw {
      map item -> CleanedItem { ... }
      store response -> cleaned { key: .id }
    }
  }

  action Load {
    for item in cleaned {
      post "/destination/data" { body: item }
    }
  }

  run Extract then Transform then Load
}
```

Each stage checkpoints independently. A failure in Load doesn't require re-running Extract or Transform.

### Scheduled missions with interruption handling

```vague
mission ScheduledSync {
  checkpoint: afterStep
  schedule: cron("0 2 * * *")  // 2 AM daily

  action Sync {
    get "/updates" { since: lastSync }
    store response -> updates { key: .id }
  }

  run Sync
}
```

If the server restarts mid-sync, the mission resumes automatically.

## Combining with other features

### With trace

```vague
mission DebugableDurable {
  checkpoint: afterStep
  trace: full

  action Process {
    // Full state capture for both durability and debugging
  }

  run Process
}
```

### With pause

```vague
mission LongRunning {
  checkpoint: afterStep

  action Step1 {
    get "/data"
    store response -> data { key: .id }
  }

  action WaitForApproval {
    pause {
      duration: "7d",
      resumeOn: webhook "/approved"
    }
  }

  action Step2 {
    for item in data {
      post "/process" { body: item }
    }
  }

  run Step1 then WaitForApproval then Step2
}
```

## Programmatic access

```typescript
import { execute, FileExecutionStore } from 'reqon';

const store = new FileExecutionStore('.reqon-data/executions');

// Check for an existing, resumable run
const state = await store.findLatest('SyncMission');

if (state && (state.status === 'paused' || state.status === 'failed')) {
  // Resume from the last checkpoint
  const result = await execute(source, {
    persistState: true,
    resumeFrom: state.id,
  });
} else {
  // Fresh execution
  const result = await execute(source, { persistState: true });
}
```

## Best practices

1. **Use afterStep for critical data** - When data loss is unacceptable
2. **Use onFailure for performance** - When failures are rare and re-processing is cheap
3. **Combine with retry** - Checkpoints + retry provides comprehensive fault tolerance
4. **Monitor checkpoint size** - Large variable state increases checkpoint overhead

## Performance considerations

| Mode | Overhead | Durability |
|------|----------|------------|
| `afterStep` | Higher (checkpoint every step) | Maximum |
| `onFailure` | Lower (checkpoint only on failure) | Good |
| None | None | No durability |

For high-throughput pipelines where re-processing is cheap, prefer `onFailure` to keep overhead low:

```vague
mission HighThroughput {
  checkpoint: onFailure  // Lower overhead

  action Batch {
    for item in items {
      post "/process" { source: API, body: item }
    }
  }

  run Batch
}
```
