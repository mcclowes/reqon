---
sidebar_position: 3
---

# Retry Strategies

Reqon provides built-in retry handling for transient failures with configurable backoff strategies.

## Basic retry configuration

```vague
get "/data" {
  retry: {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 30000
  }
}
```

## Retry options

| Option | Description | Default |
|--------|-------------|---------|
| `maxAttempts` | Maximum number of retry attempts | 3 |
| `backoff` | Backoff strategy | `exponential` |
| `initialDelay` | First retry delay (ms) | 1000 |
| `maxDelay` | Maximum delay between retries (ms) | 30000 |

## Backoff strategies

### Exponential backoff

Doubles the delay after each attempt:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000
  }
}
```

Timing:
- Attempt 1: immediate
- Attempt 2: wait 1000ms
- Attempt 3: wait 2000ms
- Attempt 4: wait 4000ms
- Attempt 5: wait 8000ms

### Linear backoff

Adds a fixed delay each time:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: linear,
    initialDelay: 2000
  }
}
```

Timing:
- Attempt 1: immediate
- Attempt 2: wait 2000ms
- Attempt 3: wait 4000ms
- Attempt 4: wait 6000ms
- Attempt 5: wait 8000ms

### Constant backoff

Same delay every time:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: constant,
    initialDelay: 5000
  }
}
```

Timing:
- Attempt 1: immediate
- Attempt 2: wait 5000ms
- Attempt 3: wait 5000ms
- Attempt 4: wait 5000ms
- Attempt 5: wait 5000ms

## Maximum delay

Cap the maximum delay:

```vague
get "/data" {
  retry: {
    maxAttempts: 10,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 30000  // Cap at 30 seconds
  }
}
```

Without maxDelay, exponential backoff would reach:
- Attempt 8: 128 seconds
- Attempt 9: 256 seconds
- Attempt 10: 512 seconds

With `maxDelay: 30000`, all delays are capped at 30 seconds.

## Conditional retry

Use `match` for conditional retry logic:

```vague
action FetchWithConditionalRetry {
  get "/data"

  match response {
    // Retry on rate limit
    { error: _, code: 429 } -> retry {
      maxAttempts: 5,
      backoff: exponential,
      initialDelay: 60000  // Start with 1 minute
    },

    // Retry on server errors
    { error: _, code: 500 } -> retry {
      maxAttempts: 3,
      backoff: exponential,
      initialDelay: 5000
    },

    // Retry on timeout
    { error: "timeout" } -> retry {
      maxAttempts: 3,
      backoff: constant,
      initialDelay: 10000
    },

    // Don't retry client errors
    { error: _, code: 400 } -> abort "Bad request",
    { error: _, code: 401 } -> abort "Unauthorized",
    { error: _, code: 404 } -> skip,

    // Success
    _ -> continue
  }
}
```

## Retry after header

Reqon respects the `Retry-After` header when present:

```vague
get "/rate-limited-api" {
  retry: {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000
  }
}
```

If the API returns:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

Reqon will wait 60 seconds before retrying, regardless of backoff settings.

## Combining with other features

### With pagination

```vague
get "/items" {
  paginate: offset(offset, 100),
  until: length(response) == 0,
  retry: {
    maxAttempts: 3,
    backoff: exponential
  }
}
```

Each page request uses retry logic independently.

### With rate limiting

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"
  }
}

action Fetch {
  get "/items" {
    retry: {
      maxAttempts: 3,
      backoff: exponential
    }
  }
}
```

Rate limiting runs before retry; retry handles unexpected failures.

## Jump and retry

For complex retry scenarios like token refresh:

```vague
action FetchData {
  get "/protected-data"

  match response {
    { error: _, code: 401 } -> jump RefreshToken then retry,
    _ -> store response -> data { key: .id }
  }
}

action RefreshToken {
  post "/auth/refresh" {
    body: { refreshToken: env("REFRESH_TOKEN") }
  }

  // Token is automatically used in subsequent requests
}
```

The `jump RefreshToken then retry` directive:
1. Executes the `RefreshToken` action
2. Retries the original request with the new token

## Per-source retry configuration

Configure default retry at the source level:

```vague
source UnreliableAPI {
  auth: bearer,
  base: "https://flaky.api.com",
  retry: {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 2000,
    maxDelay: 60000
  }
}

action Fetch {
  // Uses source-level retry config
  get "/data"
}
```

Request-level config overrides source-level:

```vague
action FetchWithOverride {
  get "/data" {
    retry: {
      maxAttempts: 10  // Override just maxAttempts
    }
  }
}
```

## Best practices

### Use exponential backoff for APIs

```vague
get "/api/data" {
  retry: {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 30000
  }
}
```

### Handle specific error codes

```vague
match response {
  // Transient errors - retry
  { code: 429 } -> retry { maxAttempts: 5 },
  { code: 503 } -> retry { maxAttempts: 3 },
  { code: 504 } -> retry { maxAttempts: 3 },

  // Permanent errors - don't retry
  { code: 400 } -> abort "Bad request",
  { code: 401 } -> abort "Unauthorized",
  { code: 403 } -> abort "Forbidden",
  { code: 404 } -> skip,

  _ -> continue
}
```

### Set reasonable limits

```vague
// Good: reasonable limits
retry: {
  maxAttempts: 5,
  maxDelay: 60000
}

// Risky: too aggressive
retry: {
  maxAttempts: 100,
  maxDelay: 1000  // 1 second
}

// Risky: too long
retry: {
  maxAttempts: 20,
  initialDelay: 60000  // 1 minute start
}
```

### Log retry attempts

Combine with match for observability:

```vague
action FetchWithLogging {
  get "/data" {
    retry: {
      maxAttempts: 3,
      backoff: exponential
    }
  }

  match response {
    { error: e } -> {
      store {
        endpoint: "/data",
        error: e,
        timestamp: now()
      } -> retryLogs
      abort e
    },
    _ -> continue
  }
}
```

## Troubleshooting

### Retry not working

Ensure the response matches retry conditions:

```vague
// Retry only triggers on match directive
match response {
  { error: _ } -> retry { maxAttempts: 3 },  // This triggers retry
  _ -> continue
}
```

### Too many retries

Add a maximum delay:

```vague
retry: {
  maxAttempts: 10,
  backoff: exponential,
  initialDelay: 1000,
  maxDelay: 30000  // Cap delays
}
```

### Retry after token refresh

Use `jump then retry`:

```vague
match response {
  { code: 401 } -> jump RefreshToken then retry,
  _ -> continue
}
```
