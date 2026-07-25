---
sidebar_position: 9
---

# Pause steps

Pause steps halt execution for extended periods (hours to weeks), persisting state and releasing resources.

## Syntax

```vague
pause {
  duration: "7d",
  persist: StoreName,
  resumeOn: timeout | webhook "/path"
}
```

## Quick reference

| Option | Type | Description |
|--------|------|-------------|
| `duration` | string/number | Required. How long to pause ("7d", "12h", 86400000) |
| `persist` | identifier | Optional. Store for pause state |
| `resumeOn` | triggers | Optional. How to resume (timeout, webhook, or both) |

## Duration formats

```vague
pause { duration: "7d" }      // 7 days
pause { duration: "12h" }     // 12 hours
pause { duration: "30m" }     // 30 minutes
pause { duration: "45s" }     // 45 seconds
pause { duration: 86400000 }  // milliseconds
```

## Resume triggers

### Timeout only (default)

```vague
pause { duration: "24h" }
```

### Webhook only

```vague
pause {
  duration: "7d",
  resumeOn: webhook "/approved"
}
```

### Both (first wins)

```vague
pause {
  duration: "7d",
  resumeOn: timeout | webhook "/approved"
}
```

## Examples

### Simple delay

```vague
action DelayedFollowUp {
  post "/emails/send" { body: { template: "welcome" } }
  pause { duration: "3d" }
  post "/emails/send" { body: { template: "follow_up" } }
}
```

### Approval workflow

```vague
action WaitForApproval {
  post "/approvals/request" { body: { documentId: doc.id } }

  pause {
    duration: "7d",
    resumeOn: timeout | webhook "/approved"
  }

  match response {
    _ where response.approved == true -> continue,
    _ -> abort "Not approved"
  }
}
```

### With persistence

```vague
mission DurableWorkflow {
  store PauseState: file("pauses")

  action WaitStep {
    pause {
      duration: "24h",
      persist: PauseState,
      resumeOn: webhook "/continue"
    }
  }

  run WaitStep
}
```

## Comparison with wait

| | `pause` | `wait` |
|---|---------|--------|
| Duration | Hours to weeks | Seconds to minutes |
| Resources | Released | Held |
| Use case | Long workflows | Async API callbacks |

Use `pause` for long durations. Use `wait` for short async callbacks.

## See also

- [Durability overview](/docs/durability/overview) - Full durability features guide
- [Pause steps (detailed)](/docs/durability/pause) - Complete pause documentation
- [Wait steps](/docs/dsl-syntax/wait) - Short-term webhook waiting
