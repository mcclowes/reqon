---
sidebar_position: 4
---

# Pause steps

Pause steps enable resource-free long pauses in mission execution, allowing workflows to wait for hours, days, or weeks without holding resources.

:::warning You drive the resume
A pause records its deadline and resume triggers, then stops the run. The shipped
runtime does **not** poll for expired pauses or route inbound webhooks into paused
runs — nothing calls `PauseManager.startMonitoring()` or `PauseManager.handleWebhook()`
for you. A paused run resumes when you re-run it with `--resume <executionId>`, or
when you drive [`PauseManager`](#programmatic-api) yourself. Read `resumeOn:` as
recorded intent, not as an automatic dispatcher.
:::

## Basic usage

```vague
action WaitForApproval {
  pause {
    duration: "7d"
  }
}
```

This pauses execution for up to 7 days, persisting state and releasing all resources.

## Pause syntax

```vague
pause {
  duration: "7d",           // Required: how long to pause
  persist: PauseStore,      // Optional: custom store for pause state
  resumeOn: timeout | webhook "/approved"  // Optional: resume triggers
}
```

## Duration formats

| Format | Example | Duration |
|--------|---------|----------|
| Days | `"7d"` | 7 days |
| Hours | `"12h"` | 12 hours |
| Minutes | `"30m"` | 30 minutes |
| Seconds | `"45s"` | 45 seconds |
| Milliseconds | `"5000ms"` or `5000` | 5 seconds |

```vague
// Various duration formats
pause { duration: "7d" }      // 7 days
pause { duration: "12h" }     // 12 hours
pause { duration: "30m" }     // 30 minutes
pause { duration: 86400000 }  // 1 day in ms
```

## Resume triggers

Pauses can resume via:

### Timeout (default)

Automatically resumes when duration expires:

```vague
pause {
  duration: "24h",
  resumeOn: timeout
}
```

### Webhook

Resumes when a webhook is received:

```vague
pause {
  duration: "7d",
  resumeOn: webhook "/approved"
}
```

With a webhook server configured, Reqon registers a listener at `{webhook-base-url}/approved` and records the trigger on the pause. A POST to that endpoint does not by itself resume the run — see the warning above; call `PauseManager.handleWebhook()` from your own handler, or re-run with `--resume`.

### Multiple triggers

Resume on whichever happens first:

```vague
pause {
  duration: "7d",
  resumeOn: timeout | webhook "/approved"
}
```

This resumes:
- After 7 days (timeout), OR
- When a POST is received at `/approved` (webhook)

## Persistence

### Default persistence

Pause state is stored in `.reqon-data/pauses/`:

```
.reqon-data/pauses/
├── pause-abc123.json
└── pause-def456.json
```

### Custom store

Use a specific store for pause state:

```vague
mission ApprovalWorkflow {
  store PauseStore: file("pause-state")

  action WaitForApproval {
    pause {
      duration: "7d",
      persist: PauseStore
    }
  }

  run WaitForApproval
}
```

## How pauses work

### Pause creation

When a pause step executes:

1. Current execution state is captured (variables, response, position)
2. State is persisted to the pause store
3. Resume triggers are recorded; a webhook listener is registered if a webhook server is configured
4. Execution halts with a `PauseSignal`
5. All resources are released

### Resume process

When a resume is driven (`--resume <executionId>`, `execute(…, { resumeFrom })`, or a `PauseManager` call):

1. Pause state is loaded from the store (or folded out of the execution log)
2. Execution context is restored
3. Execution continues from the step after the pause
4. Pause state is cleaned up

Nothing fires this on a timer. There is no background process watching deadlines.

## Use cases

### Approval workflows

```vague
mission DocumentApproval {
  source API { auth: bearer, base: "https://api.example.com" }
  store documents: file("documents")

  action SubmitForApproval {
    post "/documents" { body: document }
    store response -> documents { key: .id }
  }

  action WaitForApproval {
    // Email approvers, then wait
    post "/notifications/send" {
      body: { type: "approval_needed", documentId: doc.id }
    }

    pause {
      duration: "7d",
      resumeOn: timeout | webhook "/documents/approved"
    }
  }

  action ProcessApproved {
    match response {
      _ where response.status == "approved" -> {
        post "/documents/publish" { body: { id: doc.id } }
      },
      _ -> abort "Document not approved"
    }
  }

  run SubmitForApproval then WaitForApproval then ProcessApproved
}
```

### Scheduled follow-ups

```vague
mission FollowUpCampaign {
  action SendInitialEmail {
    post "/emails/send" { body: { template: "welcome" } }
  }

  action WaitBeforeFollowUp {
    pause { duration: "3d" }  // Wait 3 days
  }

  action SendFollowUp {
    post "/emails/send" { body: { template: "follow_up" } }
  }

  run SendInitialEmail then WaitBeforeFollowUp then SendFollowUp
}
```

### External processing

```vague
mission VideoProcessing {
  action SubmitVideo {
    post "/videos/process" { body: { videoId: video.id } }
  }

  action WaitForProcessing {
    pause {
      duration: "2h",
      resumeOn: webhook "/videos/processed"
    }
  }

  action DownloadResult {
    get "/videos/{video.id}/result"
    store response -> processedVideos { key: .id }
  }

  run SubmitVideo then WaitForProcessing then DownloadResult
}
```

### Multi-stage with human review

```vague
mission DataPipelineWithReview {
  checkpoint: afterStep  // Combine with checkpoint for full durability

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

  action ReviewGate {
    // Notify reviewers
    post "/notifications" {
      body: { message: "Data ready for review", count: cleaned.count }
    }

    pause {
      duration: "24h",
      resumeOn: webhook "/review/approved"
    }
  }

  action Load {
    for item in cleaned {
      post "/destination" { body: item }
    }
  }

  run Extract then Transform then ReviewGate then Load
}
```

## Programmatic API

### PauseManager

```typescript
import { PauseManager, MemoryPauseStore } from 'reqon-dsl';

const store = new MemoryPauseStore();
const manager = new PauseManager({ store });

// Get all active pauses
const pauses = await manager.getActivePauses();

// Get pause status
const status = await manager.getStatus();
console.log(`Active: ${status.totalActive}, Waiting: ${status.waiting}`);

// Resume a pause manually
await manager.resumeManually(pauseId);

// Cancel a pause
await manager.cancelPause(pauseId);
```

### Monitoring pauses

```typescript
const manager = new PauseManager({
  store,
  onResume: async (pause) => {
    console.log(`Pause ${pause.id} resumed by ${pause.resumedBy}`);
  },
  pollInterval: 60000  // Check for expired pauses every minute
});

// Start monitoring
manager.startMonitoring();

// Stop monitoring
manager.stopMonitoring();
```

### Webhook handling

```typescript
// In your webhook handler
app.post('/approved', async (req, res) => {
  const pauseId = req.query.pauseId;
  const success = await manager.handleWebhook(pauseId, req.body);

  if (success) {
    res.json({ status: 'resumed' });
  } else {
    res.status(404).json({ error: 'Pause not found or already resumed' });
  }
});
```

## Resuming a paused run

A pause that hasn't been triggered yet leaves the execution in the `paused` state. Resume it by execution ID:

```bash
reqon mission.vague --resume exec_abc123
```

There's no `reqon pauses` subcommand, and no trigger fires on its own. To inspect or resume individual pauses, use the `PauseManager` API shown above — including `startMonitoring()` if you want deadline polling.

## Best practices

1. **Set reasonable durations** - Don't pause for longer than necessary
2. **Own the resume path** - Decide up front what re-runs the mission: a `PauseManager` you drive, or an external scheduler calling `--resume`
3. **Combine with checkpoint** - For full durability across pauses
4. **Monitor active pauses** - Set up alerts for long-running pauses
5. **Clean up completed pauses** - Remove old pause state periodically

## Comparison with wait steps

| Feature | `pause` | `wait` |
|---------|---------|--------|
| Duration | Hours to weeks | Seconds to minutes |
| Resources | Released | Held |
| State | Persisted | In-memory |
| Resume triggers | Timeout, webhook | Webhook only |
| Use case | Long workflows | Async API callbacks |

Use `pause` for long durations where you want to release resources.
Use `wait` for short async callbacks where you need the webhook response.

## Error handling

### Pause timeout

When a pause times out without a webhook, execution continues normally:

```vague
pause {
  duration: "24h",
  resumeOn: timeout | webhook "/approved"
}

// If it timed out, response is empty; check with a guarded match
match response {
  _ where response.approved == true -> { /* webhook received */ },
  _ -> abort "Approval timeout"
}
```

### Webhook payload

Webhook payloads are available in `response` after resume:

```vague
pause {
  duration: "7d",
  resumeOn: webhook "/approved"
}

// response contains the webhook payload
store response -> approvals { key: .approvalId }
```
