---
sidebar_position: 3
---

# Interval Scheduling

Interval scheduling runs missions at fixed time intervals.

## Syntax

```vague
schedule: every N units
```

## Time Units

| Unit | Examples |
|------|----------|
| `seconds` | `every 30 seconds` |
| `minutes` | `every 15 minutes` |
| `hours` | `every 6 hours` |
| `days` | `every 1 day` |
| `weeks` | `every 1 week` |

## Examples

### Seconds

```vague
// Every 30 seconds (for real-time sync)
schedule: every 30 seconds
```

### Minutes

```vague
// Every 5 minutes
schedule: every 5 minutes

// Every 15 minutes
schedule: every 15 minutes

// Every 30 minutes
schedule: every 30 minutes
```

### Hours

```vague
// Hourly
schedule: every 1 hour

// Every 2 hours
schedule: every 2 hours

// Every 6 hours
schedule: every 6 hours

// Every 12 hours
schedule: every 12 hours
```

### Days

```vague
// Daily
schedule: every 1 day

// Every 2 days
schedule: every 2 days
```

### Weeks

```vague
// Weekly
schedule: every 1 week

// Bi-weekly
schedule: every 2 weeks
```

## Interval vs Cron

### Interval

- Runs at fixed intervals from start time
- Simpler to configure
- Less precise timing

```vague
schedule: every 6 hours
// Runs at: start, start+6h, start+12h, ...
```

### Cron

- Runs at specific times
- More control
- Predictable times

```vague
schedule: cron "0 */6 * * *"
// Runs at: 0:00, 6:00, 12:00, 18:00
```

## Start Time

Intervals start from:
1. Daemon start time (for new missions)
2. Last run time (for existing missions)

### First Run Behavior

```vague
mission ImmediateStart {
  schedule: every 1 hour
  runImmediately: true  // Run once at start
}

mission DelayedStart {
  schedule: every 1 hour
  runImmediately: false  // Wait for first interval
}
```

## Combining with Options

### With Retry

```vague
mission RobustSync {
  schedule: every 15 minutes

  retryOnFailure: {
    maxAttempts: 3,
    backoff: exponential
  }
}
```

### With Concurrency Control

```vague
mission ControlledSync {
  schedule: every 5 minutes
  skipIfRunning: true  // Don't overlap
}
```

### With Timeout

```vague
mission TimedSync {
  schedule: every 1 hour
  timeout: 1800000  // 30 minute timeout
}
```

## Use Cases

### Real-Time Sync

```vague
mission RealtimeSync {
  schedule: every 30 seconds

  action Sync {
    get "/events" { since: lastSync }
    store response -> events { key: .id }
  }
}
```

### Hourly Updates

```vague
mission HourlySync {
  schedule: every 1 hour

  action Sync {
    get "/data"
    store response -> data { key: .id }
  }
}
```

### Daily Reports

```vague
mission DailyReport {
  schedule: every 1 day

  action Generate {
    get "/stats/daily"
    store response -> reports { key: formatDate(now(), "YYYY-MM-DD") }
  }
}
```

### Weekly Cleanup

```vague
mission WeeklyCleanup {
  schedule: every 1 week

  action Cleanup {
    for item in oldData where .createdAt < addDays(now(), -30) {
      delete oldData[item.id]
    }
  }
}
```

## Best Practices

### Choose Appropriate Intervals

| Data Type | Recommended Interval |
|-----------|---------------------|
| Real-time events | 30 seconds - 5 minutes |
| Transactional data | 5-15 minutes |
| Reference data | 1-6 hours |
| Reports | Daily |
| Cleanup jobs | Weekly |

### Account for Execution Time

```vague
// If sync takes 10 minutes
schedule: every 15 minutes  // Good: 5 minute buffer

// Not:
schedule: every 5 minutes   // Risk: overlapping runs
```

### Use skipIfRunning

```vague
mission SafeSync {
  schedule: every 5 minutes
  skipIfRunning: true

  action Sync {
    // Long-running sync
  }
}
```

### Add Jitter for Distributed Systems

```vague
mission JitteredSync {
  schedule: every 1 hour
  jitter: 300000  // +/- 5 minutes random delay
}
```

## Troubleshooting

### Runs Too Frequently

Check interval unit:

```vague
// This runs every 30 SECONDS
schedule: every 30 seconds

// This runs every 30 MINUTES
schedule: every 30 minutes
```

### Runs Overlapping

Add skipIfRunning:

```vague
schedule: every 5 minutes
skipIfRunning: true
```

### Missed Runs

Intervals don't backfill. If daemon was down for 2 hours with 30-minute interval, you won't get 4 runs.

Consider:
- Using `runImmediately: true`
- Adding catch-up logic
- Using incremental sync with `since: lastSync`
