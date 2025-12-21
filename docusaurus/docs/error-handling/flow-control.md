---
sidebar_position: 1
---

# Flow Control Directives

Flow control directives determine what happens after pattern matching. They provide fine-grained control over error handling and execution flow.

## Available Directives

| Directive | Description |
|-----------|-------------|
| `continue` | Proceed to next step |
| `skip` | Skip remaining steps in current iteration |
| `abort` | Stop mission with error |
| `retry` | Retry previous request with backoff |
| `queue` | Send to dead letter queue |
| `jump...then` | Execute action, then continue |

## Continue

Proceed to the next step normally:

```vague
match response {
  { data: _ } -> continue,
  _ -> abort "No data"
}

// Execution continues here
store response.data -> data { key: .id }
```

Use `continue` when:
- Pattern matches expected success case
- You want explicit confirmation of flow

## Skip

Skip remaining steps in the current loop iteration:

```vague
for item in items {
  match item {
    { status: "inactive" } -> skip,
    { status: "deleted" } -> skip,
    _ -> continue
  }

  // Only runs for active, non-deleted items
  store item -> activeItems { key: .id }
}
```

Use `skip` when:
- Item should be ignored but processing should continue
- Filtering within a loop
- Handling non-critical errors

## Abort

Stop mission execution immediately:

```vague
match response {
  { error: msg } -> abort msg,
  { error: _ } -> abort "Unknown error occurred",
  _ -> continue
}
```

With custom message:

```vague
match response {
  { code: 401 } -> abort "Authentication failed - check credentials",
  { code: 403 } -> abort "Permission denied - check API permissions",
  { code: 404 } -> abort "Resource not found",
  { code: 500 } -> abort "Server error - try again later",
  _ -> continue
}
```

Use `abort` when:
- Unrecoverable error occurs
- Critical validation fails
- Continuing would cause data corruption

## Retry

Retry the previous HTTP request:

```vague
match response {
  { error: _, code: 429 } -> retry {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 60000
  },
  _ -> continue
}
```

### Retry Options

| Option | Description | Default |
|--------|-------------|---------|
| `maxAttempts` | Maximum retry attempts | 3 |
| `backoff` | Strategy: `exponential`, `linear`, `constant` | `exponential` |
| `initialDelay` | First retry delay (ms) | 1000 |
| `maxDelay` | Maximum delay (ms) | 30000 |
| `delay` | Fixed delay (overrides backoff) | - |

### Simple Retry

```vague
match response {
  { code: 503 } -> retry,  // Uses defaults
  _ -> continue
}
```

### Fixed Delay

```vague
match response {
  { code: 429, headers: h } -> retry {
    delay: h["Retry-After"] * 1000
  },
  _ -> continue
}
```

## Queue

Send failed items to a dead letter queue:

```vague
match response {
  { error: e } -> queue dlq {
    item: {
      request: currentRequest,
      error: e,
      timestamp: now()
    }
  },
  _ -> continue
}
```

### Queue Options

```vague
queue queueName {
  item: itemToStore,
  key: optionalKey
}
```

Store the queue as a regular store:

```vague
mission ErrorHandling {
  store dlq: file("dead-letter-queue")

  action Process {
    get "/data"

    match response {
      { error: e } -> queue dlq { item: { error: e } },
      _ -> continue
    }
  }
}
```

## Jump Then

Execute another action, then continue or retry:

```vague
match response {
  { code: 401 } -> jump RefreshToken then retry,
  _ -> continue
}

action RefreshToken {
  post "/auth/refresh" {
    body: { refreshToken: env("REFRESH_TOKEN") }
  }
}
```

### Jump Then Retry

Common pattern for token refresh:

```vague
action FetchData {
  get "/protected-resource"

  match response {
    { code: 401 } -> jump RefreshToken then retry,
    _ -> store response -> data { key: .id }
  }
}

action RefreshToken {
  post "/oauth/token" {
    body: {
      grant_type: "refresh_token",
      refresh_token: env("REFRESH_TOKEN")
    }
  }
  // New token is automatically used
}
```

### Jump Then Continue

```vague
match response {
  { needsSetup: true } -> jump SetupResource then continue,
  _ -> continue
}
```

## Combining Directives

### Layered Error Handling

```vague
match response {
  // Retry transient errors
  { code: 429 } -> retry { maxAttempts: 5 },
  { code: 503 } -> retry { maxAttempts: 3 },
  { code: 504 } -> retry { maxAttempts: 3 },

  // Handle auth separately
  { code: 401 } -> jump RefreshToken then retry,

  // Queue unrecoverable errors
  { code: 400, error: e } -> queue dlq { item: { error: e } },

  // Abort on critical errors
  { code: 500, error: e } -> abort e,

  // Skip missing resources
  { code: 404 } -> skip,

  // Continue on success
  _ -> continue
}
```

### Per-Item Error Handling

```vague
for item in items {
  get concat("/items/", item.id)

  match response {
    { error: _, code: 404 } -> {
      // Log and skip
      store { id: item.id, status: "not_found" } -> missing
      skip
    },
    { error: e } -> {
      // Queue for retry
      queue failed { item: { id: item.id, error: e } }
      skip
    },
    _ -> continue
  }

  store response -> processedItems { key: .id }
}
```

## Best Practices

### Be Specific

```vague
// Good: specific error handling
match response {
  { code: 401 } -> jump RefreshToken then retry,
  { code: 403 } -> abort "Permission denied",
  { code: 429 } -> retry { delay: 60000 },
  { code: 404 } -> skip,
  { error: e } -> abort e,
  _ -> continue
}

// Avoid: too generic
match response {
  { error: _ } -> retry,
  _ -> continue
}
```

### Always Have a Default

```vague
match response {
  { status: "ok" } -> continue,
  { status: "error" } -> abort "Error",
  _ -> abort "Unexpected response"  // Always have catch-all
}
```

### Log Before Abort

```vague
match response {
  { error: e } -> {
    store { error: e, timestamp: now() } -> errorLog
    abort e
  },
  _ -> continue
}
```

### Use Queue for Later Processing

```vague
match response {
  { error: "rate_limit" } -> queue retryQueue {
    item: {
      request: currentRequest,
      retryAfter: response.retryAfter
    }
  },
  _ -> continue
}
```
