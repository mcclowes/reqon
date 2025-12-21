# Scheduled Reports Example

Demonstrates Reqon's scheduling capabilities for automated report generation.

## Key Features

| Feature | Description |
|---------|-------------|
| `schedule: cron` | Cron expression scheduling |
| `schedule: every N unit` | Interval-based scheduling |
| `schedule: at "time"` | Specific time scheduling |
| `skipIfRunning` | Prevent overlapping executions |
| `retryOnFailure` | Automatic retry on failures |
| `maxConcurrency` | Limit concurrent instances |

## Schedule Formats

### Cron Expressions
```vague
schedule: cron "0 6 * * *"      // Every day at 6:00 AM
schedule: cron "0 */4 * * *"    // Every 4 hours
schedule: cron "0 9 * * 1"      // Every Monday at 9:00 AM
schedule: cron "0 0 1 * *"      // First day of each month
```

### Interval-Based
```vague
schedule: every 15 minutes
schedule: every 1 hour
schedule: every 6 hours
schedule: every 1 day
```

### Specific Time
```vague
schedule: at "09:00"            // Daily at 9:00 AM
schedule: at "23:55"            // Daily at 11:55 PM
schedule: at "2024-12-25T00:00" // Specific datetime
```

## Scheduling Options

```vague
mission ScheduledMission {
  schedule: cron "0 6 * * *"

  // Don't start if previous run still executing
  skipIfRunning: true

  // Retry up to 3 times on failure
  retryOnFailure: 3

  // Maximum concurrent instances
  maxConcurrency: 1

  // ...
}
```

## Usage

```bash
# Run as daemon (continuous scheduling)
node dist/cli.js examples/scheduled-reports/reports.vague --daemon

# Run once (ignore schedule, execute immediately)
node dist/cli.js examples/scheduled-reports/reports.vague --run-now

# Dry run to test schedule parsing
node dist/cli.js examples/scheduled-reports/reports.vague --dry-run
```

## Common Cron Patterns

| Pattern | Description |
|---------|-------------|
| `0 * * * *` | Every hour |
| `0 0 * * *` | Every day at midnight |
| `0 6 * * *` | Every day at 6 AM |
| `0 9 * * 1-5` | Weekdays at 9 AM |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 0 1 * *` | First of each month |
| `*/15 * * * *` | Every 15 minutes |

## Best Practices

1. **Use `skipIfRunning`** for long-running jobs to prevent overlap
2. **Set appropriate `retryOnFailure`** for critical reports
3. **Consider timezone** when setting schedules (default is UTC)
4. **Use parallel fetching** for independent data sources
5. **Include alerting** for failures and anomalies
