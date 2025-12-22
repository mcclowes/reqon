---
sidebar_position: 2
---

# Cron expressions

Reqon supports full cron expression syntax for precise scheduling.

## Syntax

```vague
schedule: cron "minute hour day month weekday"
```

## Field reference

| Field | Values | Special Characters |
|-------|--------|-------------------|
| Minute | 0-59 | * , - / |
| Hour | 0-23 | * , - / |
| Day of Month | 1-31 | * , - / |
| Month | 1-12 | * , - / |
| Day of Week | 0-6 (0=Sunday) | * , - / |

## Special characters

| Character | Meaning | Example |
|-----------|---------|---------|
| `*` | Any value | `* * * * *` = every minute |
| `,` | Value list | `0,30 * * * *` = minute 0 and 30 |
| `-` | Range | `0 9-17 * * *` = 9am to 5pm |
| `/` | Step | `*/15 * * * *` = every 15 minutes |

## Common patterns

### Every minute

```vague
schedule: cron "* * * * *"
```

### Every hour

```vague
// At minute 0
schedule: cron "0 * * * *"
```

### Every N minutes

```vague
// Every 5 minutes
schedule: cron "*/5 * * * *"

// Every 15 minutes
schedule: cron "*/15 * * * *"

// Every 30 minutes
schedule: cron "*/30 * * * *"
```

### Every N hours

```vague
// Every 2 hours
schedule: cron "0 */2 * * *"

// Every 6 hours
schedule: cron "0 */6 * * *"

// Every 12 hours
schedule: cron "0 */12 * * *"
```

### Daily

```vague
// At midnight
schedule: cron "0 0 * * *"

// At 6am
schedule: cron "0 6 * * *"

// At 9am
schedule: cron "0 9 * * *"

// At 11pm
schedule: cron "0 23 * * *"
```

### Multiple times per day

```vague
// At 9am and 5pm
schedule: cron "0 9,17 * * *"

// At midnight, 8am, 4pm
schedule: cron "0 0,8,16 * * *"
```

### Weekly

```vague
// Every Sunday at midnight
schedule: cron "0 0 * * 0"

// Every Monday at 9am
schedule: cron "0 9 * * 1"

// Every Friday at 5pm
schedule: cron "0 17 * * 5"
```

### Weekdays only

```vague
// Weekdays at 9am
schedule: cron "0 9 * * 1-5"

// Weekdays every hour during business hours
schedule: cron "0 9-17 * * 1-5"
```

### Weekends only

```vague
// Weekends at noon
schedule: cron "0 12 * * 0,6"
```

### Monthly

```vague
// First of month at midnight
schedule: cron "0 0 1 * *"

// First of month at 6am
schedule: cron "0 6 1 * *"

// 15th of month at noon
schedule: cron "0 12 15 * *"

// Last day approach: run on 28th
schedule: cron "0 0 28 * *"
```

### Quarterly

```vague
// First day of quarter at 6am
schedule: cron "0 6 1 1,4,7,10 *"
```

### Yearly

```vague
// January 1st at midnight
schedule: cron "0 0 1 1 *"

// First Monday of year (approximate)
schedule: cron "0 9 1-7 1 1"
```

## Complex examples

### Business hours only

```vague
// Every 30 minutes, 9am-5pm, weekdays
schedule: cron "*/30 9-17 * * 1-5"
```

### Night batch jobs

```vague
// At 2am every day
schedule: cron "0 2 * * *"
```

### Multiple specific times

```vague
// 8am, 12pm, 6pm every day
schedule: cron "0 8,12,18 * * *"
```

### End of month (approximation)

```vague
// 28th of every month
schedule: cron "0 0 28 * *"
```

## Timezone handling

Cron expressions use the system timezone by default.

### Specify timezone

```vague
mission TimezoneSync {
  schedule: cron "0 9 * * *"
  timezone: "America/New_York"
}
```

### UTC

```vague
mission UTCSync {
  schedule: cron "0 9 * * *"
  timezone: "UTC"
}
```

## Testing cron expressions

### Dry run

```bash
reqon ./mission.vague --dry-run
# Shows: Next run at: 2024-01-20 09:00:00
```

### Validate expression

```bash
reqon --validate-cron "0 9 * * *"
# Valid cron expression
# Next 5 runs:
#   2024-01-20 09:00:00
#   2024-01-21 09:00:00
#   2024-01-22 09:00:00
#   2024-01-23 09:00:00
#   2024-01-24 09:00:00
```

## Best practices

### Avoid midnight

Many systems run jobs at midnight, causing load spikes:

```vague
// Instead of 0 0 * * *
schedule: cron "0 3 * * *"  // 3am
```

### Spread load

Stagger related jobs:

```vague
mission SyncCustomers {
  schedule: cron "0 * * * *"  // On the hour
}

mission SyncOrders {
  schedule: cron "15 * * * *"  // 15 past
}

mission SyncProducts {
  schedule: cron "30 * * * *"  // 30 past
}
```

### Consider execution time

Account for job duration:

```vague
// If job takes 10 minutes, don't schedule every 5
schedule: cron "*/15 * * * *"  // Every 15 minutes

// Or use skipIfRunning
skipIfRunning: true
```

## Troubleshooting

### Wrong times

Check timezone settings:

```bash
date  # System time
TZ=UTC date  # UTC time
```

### Missed runs

If daemon was down, jobs don't backfill. Consider:

```vague
retryOnFailure: { maxAttempts: 3 }
```

### Expression errors

Validate syntax:

```bash
reqon --validate-cron "invalid"
# Error: Invalid cron expression
```
