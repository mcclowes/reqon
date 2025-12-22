---
sidebar_position: 1
---

# Scheduling overview

Reqon supports scheduling missions to run automatically at specified intervals or times.

## Schedule types

| Type | Syntax | Example |
|------|--------|---------|
| Interval | `every N units` | `every 6 hours` |
| Cron | `cron "expression"` | `cron "0 */6 * * *"` |
| One-time | `at "datetime"` | `at "2024-01-20 09:00 UTC"` |

## Quick start

```vague
mission DailySync {
  schedule: every 1 day

  source API { auth: bearer, base: "https://api.example.com" }
  store data: file("data")

  action Sync {
    get "/data" { since: lastSync }
    store response -> data { key: .id }
  }

  run Sync
}
```

## Running scheduled missions

### Daemon mode

Run continuously:

```bash
reqon ./missions/ --daemon
```

### One-shot mode

Run once and exit:

```bash
reqon ./missions/ --once
```

## Interval scheduling

```vague
// Every N minutes
schedule: every 15 minutes

// Every N hours
schedule: every 6 hours

// Every N days
schedule: every 1 day

// Every N weeks
schedule: every 1 week
```

## Cron scheduling

Full cron expression support:

```vague
// Every day at midnight
schedule: cron "0 0 * * *"

// Every hour
schedule: cron "0 * * * *"

// Every 6 hours
schedule: cron "0 */6 * * *"

// Weekdays at 9am
schedule: cron "0 9 * * 1-5"

// First of month at 6am
schedule: cron "0 6 1 * *"
```

## One-time scheduling

```vague
// Specific datetime
schedule: at "2024-12-25 00:00 UTC"

// ISO format
schedule: at "2024-01-20T09:00:00Z"
```

## Schedule options

```vague
mission ConfiguredSync {
  schedule: every 1 hour

  // Concurrency control
  maxConcurrency: 5

  // Skip if already running
  skipIfRunning: true

  // Retry on failure
  retryOnFailure: {
    maxAttempts: 3,
    backoff: exponential
  }
}
```

## Multiple missions

Each mission has its own schedule:

```vague
mission FrequentSync {
  schedule: every 15 minutes
  // ...
}

mission DailyReport {
  schedule: every 1 day
  // ...
}

mission WeeklyCleanup {
  schedule: cron "0 0 * * 0"  // Sundays at midnight
  // ...
}
```

## Execution context

### Last run time

Access when mission last ran:

```vague
action IncrementalSync {
  get "/data" {
    since: lastSync  // Uses last successful completion time
  }
}
```

### Scheduled vs manual

Detect if running on schedule:

```vague
action FlexibleSync {
  match env("REQON_SCHEDULED") {
    "true" -> get "/data" { since: lastSync },
    _ -> get "/data"  // Full sync for manual runs
  }
}
```

## Best practices

### Use incremental sync

```vague
mission EfficientSync {
  schedule: every 15 minutes

  action Sync {
    get "/data" { since: lastSync }  // Only fetch changes
    store response -> data { key: .id, upsert: true }
  }
}
```

### Add error handling

```vague
mission RobustSync {
  schedule: every 1 hour

  retryOnFailure: {
    maxAttempts: 3,
    backoff: exponential
  }

  action Sync {
    get "/data"

    match response {
      { error: _ } -> abort "Sync failed",
      _ -> store response -> data { key: .id }
    }
  }
}
```

### Monitor execution

```vague
mission MonitoredSync {
  schedule: every 1 hour

  store syncLog: file("sync-log")

  action Sync {
    store { started: now() } -> syncLog

    get "/data"
    store response -> data { key: .id }

    store {
      completed: now(),
      itemCount: length(response)
    } -> syncLog
  }
}
```

## Next steps

- [Cron Expressions](./cron) - Detailed cron syntax
- [Intervals](./intervals) - Interval scheduling
- [Daemon Mode](./daemon-mode) - Running as a service
