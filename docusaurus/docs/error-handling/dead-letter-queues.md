---
sidebar_position: 3
---

# Dead letter queues

Dead letter queues (DLQ) store failed items for later processing. They prevent data loss when errors occur and allow for manual or automated retry.

## Basic usage

```vague
mission DataSync {
  store data: file("data")
  store dlq: file("dead-letter-queue")

  action FetchData {
    get "/items"

    for item in response.items {
      get concat("/items/", item.id, "/details")

      match response {
        { error: e } -> queue dlq {
          item: {
            itemId: item.id,
            error: e,
            timestamp: now()
          }
        },
        _ -> store response -> data { key: item.id }
      }
    }
  }

  run FetchData
}
```

## Queue directive syntax

```vague
queue storeName {
  item: objectToStore,
  key: optionalKey
}
```

### With key

```vague
queue dlq {
  item: { error: "failed" },
  key: concat("error-", item.id)
}
```

### Without key (auto-generated)

```vague
queue dlq {
  item: { error: "failed" }
}
```

## What to include

### Minimum information

```vague
queue dlq {
  item: {
    id: item.id,
    error: response.error,
    timestamp: now()
  }
}
```

### Full context

```vague
queue dlq {
  item: {
    // Identifiers
    id: item.id,
    batchId: batchId,

    // Original data
    originalItem: item,

    // Error details
    error: response.error,
    errorCode: response.code,
    errorDetails: response.details,

    // Context
    action: "FetchDetails",
    source: "ExternalAPI",

    // Timing
    timestamp: now(),
    attemptCount: 1,

    // For retry
    retryable: response.code >= 500
  }
}
```

## DLQ patterns

### Simple error queue

```vague
mission Simple {
  store dlq: file("errors")

  action Process {
    for item in items {
      get concat("/api/", item.id)

      match response {
        { error: _ } -> queue dlq { item: { id: item.id, response: response } },
        _ -> continue
      }
    }
  }
}
```

### Categorized queues

```vague
mission Categorized {
  store retryable: file("retryable-errors")
  store permanent: file("permanent-errors")
  store validation: file("validation-errors")

  action Process {
    for item in items {
      get concat("/api/", item.id)

      match response {
        // Retryable errors
        { code: 429 } -> queue retryable { item: { id: item.id, reason: "rate_limit" } },
        { code: 500 } -> queue retryable { item: { id: item.id, reason: "server_error" } },
        { code: 503 } -> queue retryable { item: { id: item.id, reason: "unavailable" } },

        // Permanent errors
        { code: 401 } -> queue permanent { item: { id: item.id, reason: "auth" } },
        { code: 403 } -> queue permanent { item: { id: item.id, reason: "forbidden" } },
        { code: 404 } -> queue permanent { item: { id: item.id, reason: "not_found" } },

        // Validation errors
        { code: 400 } -> queue validation { item: { id: item.id, details: response } },

        // Success
        _ -> continue
      }
    }
  }
}
```

### DLQ with retry counter

```vague
for item in items {
  get concat("/api/", item.id)

  match response {
    { error: _ } where item.retryCount >= 3 -> {
      // Max retries exceeded
      queue permanentFailures {
        item: { ...item, finalError: response.error }
      }
      skip
    },
    { error: _ } -> {
      // Queue for retry
      queue retryQueue {
        item: {
          ...item,
          retryCount: (item.retryCount or 0) + 1,
          lastError: response.error
        }
      }
      skip
    },
    _ -> continue
  }
}
```

## Processing DLQ

### Manual review

Export and review:

```bash
reqon mission.vague --output ./exports/
# Review exports/dead-letter-queue.json
```

### Automated retry

Create a retry mission:

```vague
mission RetryFailed {
  store dlq: file("dead-letter-queue")
  store data: file("data")
  store permanentFailed: file("permanent-failures")

  action RetryItems {
    for item in dlq where .retryable == true {
      get concat("/api/", item.originalItem.id)

      match response {
        { error: _ } where item.attemptCount >= 5 -> {
          // Give up after 5 attempts
          store {
            ...item,
            finalError: response.error
          } -> permanentFailed { key: item.id }
          delete dlq[item.id]
        },
        { error: _ } -> {
          // Update retry count
          store {
            ...item,
            attemptCount: item.attemptCount + 1,
            lastAttempt: now(),
            lastError: response.error
          } -> dlq { key: item.id }
        },
        _ -> {
          // Success! Remove from DLQ
          store response -> data { key: item.originalItem.id }
          delete dlq[item.id]
        }
      }
    }
  }

  run RetryItems
}
```

### Scheduled retry

```vague
mission ScheduledRetry {
  schedule: every 1 hour

  store dlq: file("dead-letter-queue")

  action RetryEligible {
    for item in dlq where .lastAttempt < addHours(now(), -1) {
      // Retry items not attempted in the last hour
      // ... retry logic
    }
  }

  run RetryEligible
}
```

## DLQ with notifications

```vague
action NotifyOnFailure {
  for item in items {
    get concat("/api/", item.id)

    match response {
      { error: e } -> {
        // Queue for retry
        queue dlq { item: { id: item.id, error: e } }

        // Check if threshold exceeded
        match dlq {
          _ where length(dlq) > 100 -> {
            // Too many failures - alert
            post NotificationAPI "/alerts" {
              body: {
                message: "DLQ threshold exceeded",
                count: length(dlq),
                timestamp: now()
              }
            }
          },
          _ -> continue
        }
      },
      _ -> continue
    }
  }
}
```

## Best practices

### Include enough context

```vague
queue dlq {
  item: {
    // What failed
    id: item.id,
    originalData: item,

    // Why it failed
    error: response.error,
    errorCode: response.code,

    // When it failed
    timestamp: now(),

    // Can we retry?
    retryable: response.code >= 500,

    // How many times have we tried?
    attemptCount: 1
  }
}
```

### Separate retryable vs permanent

```vague
// Retryable: server errors, rate limits
queue retryQueue { item: { ... } }

// Permanent: validation errors, not found
queue permanentQueue { item: { ... } }
```

### Set retention policies

Periodically clean old entries:

```vague
action CleanOldEntries {
  for item in dlq where .timestamp < addDays(now(), -30) {
    // Archive or delete items older than 30 days
    delete dlq[item.id]
  }
}
```

### Monitor queue size

```vague
action MonitorDLQ {
  match dlq {
    _ where length(dlq) > 1000 -> {
      // Alert on large queue
      store {
        alert: "DLQ size exceeded 1000",
        size: length(dlq),
        timestamp: now()
      } -> alerts
    },
    _ -> continue
  }
}
```

## Troubleshooting

### Queue growing too fast

1. Check for systemic issues
2. Review error patterns
3. Fix root cause before retrying

### Items never succeed

Mark as permanent failure:

```vague
match item {
  _ where item.attemptCount > 10 -> {
    store item -> permanentFailures { key: item.id }
    delete dlq[item.id]
  },
  _ -> continue
}
```

### Duplicate processing

Use idempotent operations:

```vague
store response -> data { key: item.id, upsert: true }
```
