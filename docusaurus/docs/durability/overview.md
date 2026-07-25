---
sidebar_position: 1
---

# Durability overview

Reqon provides durability features for building resilient, long-running pipelines that can survive failures and span extended time periods.

## What is durability?

Durability in Reqon means:

- **Checkpoint/Resume**: Save execution state after each step so missions can resume after crashes or restarts
- **Time-travel debugging**: Capture complete state snapshots for debugging and replay
- **Resource-free pauses**: Pause execution for hours, days, or weeks without holding resources

## When to use durability features

### Checkpoint/Resume

Use when you need fault-tolerant execution:

```vague
mission CriticalSync {
  checkpoint: afterStep  // Save state after every step

  action FetchData {
    get "/large-dataset" { paginate: offset(page, 100) }
    store response -> data { key: .id }
  }

  run FetchData
}
```

If the mission crashes at step 50 of 100, it resumes from step 50 on restart.

### Time-travel debugging

Use when you need to understand what happened during execution:

```vague
mission ComplexPipeline {
  trace: full  // Capture complete state at each step

  action Process {
    // Complex logic...
  }

  run Process
}
```

After execution, replay the trace to see exactly what happened at each step.

### Resource-free pauses

Use when your workflow needs to wait for extended periods:

```vague
mission ApprovalWorkflow {
  action WaitForApproval {
    post "/approvals/request" { body: { documentId: doc.id } }

    pause {
      duration: "7d",
      resumeOn: timeout | webhook "/approved"
    }
  }

  run WaitForApproval
}
```

The pause persists state and releases all resources. Execution resumes when the timeout expires or a webhook is received.

## Combining features

Durability features work together:

```vague
mission RobustPipeline {
  checkpoint: afterStep
  trace: full

  action FetchAndProcess {
    get "/data"
    store response -> data { key: .id }
  }

  action WaitForReview {
    pause {
      duration: "24h",
      resumeOn: webhook "/reviewed"
    }
  }

  action Finalize {
    for item in data {
      post "/finalize" { body: item }
    }
  }

  run FetchAndProcess then WaitForReview then Finalize
}
```

This mission:
1. Checkpoints after each step for crash recovery
2. Records full execution trace for debugging
3. Pauses for up to 24 hours waiting for review

## Architecture

### State persistence

Durability state is stored under `.reqon-data/`:

```
.reqon-data/
├── executions/         # Execution records
├── traces/             # Trace snapshots
├── pauses/             # Pause state
└── sync/               # Incremental-sync checkpoints (one per mission)
```

### Programmatic access

```typescript
import {
  TraceReplayer,
  PauseManager,
  MemoryTraceStore,
  MemoryPauseStore
} from 'reqon';

// Replay execution traces
const replayer = new TraceReplayer(traceStore);
const session = await replayer.loadTrace('exec-123');
await replayer.goToStep(5);
const diff = replayer.compareSnapshots(4, 5);

// Manage pauses
const manager = new PauseManager({ store: pauseStore });
const pauses = await manager.getActivePauses();
await manager.resumeManually(pauseId);
```

## Next steps

- [Checkpoint configuration](./checkpoint) - Configure durable execution
- [Time-travel debugging](./trace) - Capture and replay execution traces
- [Pause steps](./pause) - Resource-free long pauses
