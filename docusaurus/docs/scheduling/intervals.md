---
sidebar_position: 3
---

# Interval scheduling

Interval scheduling runs missions at fixed time intervals.

## Syntax

```vague
schedule: every N units
```

## Time units

| Unit | Examples |
|------|----------|
| `seconds` | `every 30 seconds` |
| `minutes` | `every 15 minutes` |
| `hours` | `every 6 hours` |
| `days` | `every 1 days` |
| `weeks` | `every 1 weeks` |

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
schedule: every 1 hours

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
schedule: every 1 days

// Every 2 days
schedule: every 2 days
```

### Weeks

```vague
// Weekly
schedule: every 1 weeks

// Bi-weekly
schedule: every 2 weeks
```

## Interval vs cron

### Interval

- Runs at fixed intervals from start time
- Simpler to configure
- Less precise timing

```vague
schedule: every 6 hours
// Runs at: start, start+6h, start+12h, ...
```

### cron

- Runs at specific times
- More control
- Predictable times

```vague
schedule: cron "0 */6 * * *"
// Runs at: 0:00, 6:00, 12:00, 18:00
```

## Start time

Intervals start from:
1. Daemon start time (for new missions)
2. Last run time (for existing missions)

To run once immediately rather than waiting for the daemon to reach the next interval, start the daemon with `--once`, which runs every scheduled mission a single time and exits.

## Combining with options

Schedule options go inside the optional `{ }` block on the schedule, not as mission-level fields.

### With retry

```vague
mission RobustSync {
  schedule: every 15 minutes {
    retry: {
      maxRetries: 3,
      delaySeconds: 60
    }
  }
}
```

### With concurrency control

```vague
mission ControlledSync {
  schedule: every 5 minutes {
    skipIfRunning: true  // Don't overlap
  }
}
```

## Use cases

### Real-time sync

```vague
mission RealtimeSync {
  schedule: every 30 seconds

  action Sync {
    get "/events" { since: lastSync }
    store response -> events { key: .id }
  }
}
```

### Hourly updates

```vague
mission HourlySync {
  schedule: every 1 hours

  action Sync {
    get "/data"
    store response -> data { key: .id }
  }
}
```

### Daily reports

```vague
mission DailyReport {
  schedule: every 1 days

  action Generate {
    get "/stats/daily"
    store response -> reports { key: formatDate(now(), "YYYY-MM-DD") }
  }
}
```

### Weekly archive

```vague
mission WeeklyArchive {
  schedule: every 1 weeks

  action Archive {
    get "/records/stale"
    store response -> archive { key: .id, upsert: true }
  }
}
```

## Best practices

### Choose appropriate intervals

| Data Type | Recommended Interval |
|-----------|---------------------|
| Real-time events | 30 seconds - 5 minutes |
| Transactional data | 5-15 minutes |
| Reference data | 1-6 hours |
| Reports | Daily |
| Cleanup jobs | Weekly |

### Account for execution time

```vague
// If sync takes 10 minutes
schedule: every 15 minutes  // Good: 5 minute buffer

// Not:
schedule: every 5 minutes   // Risk: overlapping runs
```

### Use skipIfRunning

```vague
mission SafeSync {
  schedule: every 5 minutes {
    skipIfRunning: true
  }

  action Sync {
    // Long-running sync
  }
}
```

## Troubleshooting

### Runs too frequently

Check interval unit:

```vague
// This runs every 30 SECONDS
schedule: every 30 seconds

// This runs every 30 MINUTES
schedule: every 30 minutes
```

### Runs overlapping

Add `skipIfRunning` to the schedule block:

```vague
schedule: every 5 minutes {
  skipIfRunning: true
}
```

### Missed runs

Intervals don't backfill. If the daemon was down for 2 hours with a 30-minute interval, you won't get 4 runs.

Consider:
- Adding catch-up logic
- Using incremental sync with `since: lastSync`
