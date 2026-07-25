---
sidebar_position: 1
---

# Flow control directives

Flow control directives appear on the right-hand side of a `match` arm and determine what happens next. They give you control over error handling and execution flow.

A `match` arm's left side is a schema name, `_` (the wildcard), or either of those with a `where` guard. You can't match on object shapes or literal values, so flow control branches on the matched value against named schemas and guard conditions, not on raw patterns.

`match` works on the matched value, which for `match response` is the successful response body. HTTP errors (status 400 and up) don't reach a `match` arm: the request throws and either retries at the fetch level or fails the mission. Use the fetch `retry:` block for transient HTTP errors (see [Retry strategies](./retry-strategies)), and use these directives to branch on the body you got back.

## Available directives

| Directive | Description |
|-----------|-------------|
| `continue` | Proceed to the next step |
| `skip` | Skip remaining steps in the current action or loop iteration |
| `abort` | Stop the mission with an error |
| `retry` | Re-run the current action with backoff |
| `queue` | Stash the matched value in a store |
| `jump...then` | Run another action, then continue or retry |

## Continue

Proceed to the next step normally:

```vague
match response {
  Result -> continue,
  _ -> abort "No data"
}

// Execution continues here
store response -> data { key: .id }
```

Use `continue` when:
- The value matches the expected success schema
- You want explicit confirmation of flow

## Skip

Skip remaining steps in the current loop iteration:

```vague
for item in items {
  match item {
    Inactive -> skip,
    Deleted -> skip,
    _ -> continue
  }

  // Only runs for active, non-deleted items
  store item -> activeItems { key: .id }
}
```

Use `skip` when:
- An item should be ignored but processing should continue
- Filtering within a loop
- Handling non-critical errors

## Abort

Stop mission execution immediately. `abort` takes no message, or a single string literal — it can't take an expression or variable:

```vague
match response {
  ApiError -> abort "API returned an error",
  _ -> continue
}
```

With different messages per case:

```vague
match response {
  AuthError -> abort "Authentication failed - check credentials",
  RateLimited -> abort "Rate limited - try again later",
  _ -> continue
}
```

Use `abort` when:
- An unrecoverable error occurs
- Critical validation fails
- Continuing would corrupt data

## Retry

Re-run the current action with backoff. This replays the whole action, not just the last request, so it's for cases where the body tells you the result wasn't ready:

```vague
match response {
  _ where response.pending -> retry {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 60000
  },
  _ -> continue
}
```

### Retry options

| Option | Description | Default |
|--------|-------------|---------|
| `maxAttempts` | Maximum attempts | 3 |
| `backoff` | Strategy: `exponential`, `linear`, `constant` | `exponential` |
| `initialDelay` | First retry delay (ms) | 1000 |
| `maxDelay` | Maximum delay (ms) | - |
| `timeout` | Per-attempt timeout (ms) | - |

### Simple retry

```vague
match response {
  _ where response.pending -> retry,  // Uses defaults
  _ -> continue
}
```

## Queue

Stash the matched value in a store, which acts as a dead letter queue. `queue` takes a store name; it stashes the current matched value (here, the response body). There's no payload block — to control what gets queued, match over the value you want to store:

```vague
match response {
  ApiError -> queue dlq,
  _ -> continue
}
```

The queued value is keyed by its own `id` field, or by an auto-generated `queued-N` key when it has none. `queue` with no store name discards the value, so always name a target.

Store the queue as a regular store:

```vague
mission ErrorHandling {
  store dlq: file("dead-letter-queue")

  action Process {
    get "/data"

    match response {
      ApiError -> queue dlq,
      _ -> continue
    }
  }
}
```

## Jump then

Run another action, then continue or retry:

```vague
match response {
  _ where response.needsSetup -> jump SetupResource then continue,
  _ -> continue
}

action SetupResource {
  post "/setup" {
    body: { ready: true }
  }
}
```

After `jump SetupResource`, `then retry` re-runs the current action and `then continue` proceeds to the next step. Plain `jump SetupResource` runs the action and continues.

Note that HTTP 401 responses throw rather than reaching a `match` arm, and OAuth token refresh is handled by the auth provider, not by a flow directive. Use `jump` for application-level conditions you can read off the response body.

### Jump then retry

```vague
action FetchData {
  get "/resource"

  match response {
    _ where response.stale -> jump RefreshCache then retry,
    _ -> store response -> data { key: .id }
  }
}

action RefreshCache {
  post "/cache/refresh"
}
```

### Jump then continue

```vague
match response {
  _ where response.needsSetup -> jump SetupResource then continue,
  _ -> continue
}
```

## Combining directives

### Layered handling

```vague
match response {
  // Re-run while the body says it's not ready
  _ where response.pending -> retry { maxAttempts: 5 },

  // Refresh derived state, then re-run
  _ where response.stale -> jump RefreshCache then retry,

  // Queue bodies the API flagged as errors
  ApiError -> queue dlq,

  // Abort on a fatal flag
  _ where response.fatal -> abort "Fatal error in response",

  // Continue on success
  _ -> continue
}
```

### Per-item handling

```vague
for item in items {
  get concat("/items/", item.id)

  match response {
    Missing -> {
      store { id: item.id, status: "not_found" } -> missing
      skip
    },
    ApiError -> {
      queue failed
      skip
    },
    _ -> continue
  }

  store response -> processedItems { key: .id }
}
```

## Best practices

### Be specific

```vague
// Good: branch on schemas and clear guards
match response {
  _ where response.stale -> jump RefreshCache then retry,
  _ where response.fatal -> abort "Fatal error",
  Missing -> skip,
  ApiError -> queue dlq,
  _ -> continue
}

// Avoid: too generic
match response {
  _ where response.error -> retry,
  _ -> continue
}
```

### Always have a default

```vague
match response {
  Ok -> continue,
  ApiError -> abort "Error",
  _ -> abort "Unexpected response"  // Always have a catch-all
}
```

### Log before abort

```vague
match response {
  ApiError -> {
    store { error: response.error, timestamp: now() } -> errorLog
    abort "API returned an error"
  },
  _ -> continue
}
```

### Use queue for later processing

```vague
match response {
  RateLimited -> queue retryQueue,
  _ -> continue
}
```
