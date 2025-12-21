---
sidebar_position: 2
---

# Retry Strategies

Reqon provides configurable retry strategies for handling transient failures. Choose the right strategy based on your API's behavior.

## Retry Configuration

```reqon
retry: {
  maxAttempts: 5,
  backoff: exponential,
  initialDelay: 1000,
  maxDelay: 60000
}
```

## Backoff Strategies

### Exponential Backoff

Best for most APIs. Delays double after each attempt:

```reqon
match response {
  { code: 429 } -> retry {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000
  },
  _ -> continue
}
```

Timeline:
```
Attempt 1: immediate
Attempt 2: wait 1000ms (1s)
Attempt 3: wait 2000ms (2s)
Attempt 4: wait 4000ms (4s)
Attempt 5: wait 8000ms (8s)
```

### Linear Backoff

Delays increase by a fixed amount:

```reqon
match response {
  { code: 503 } -> retry {
    maxAttempts: 5,
    backoff: linear,
    initialDelay: 2000
  },
  _ -> continue
}
```

Timeline:
```
Attempt 1: immediate
Attempt 2: wait 2000ms (2s)
Attempt 3: wait 4000ms (4s)
Attempt 4: wait 6000ms (6s)
Attempt 5: wait 8000ms (8s)
```

### Constant Backoff

Same delay every time:

```reqon
match response {
  { code: 504 } -> retry {
    maxAttempts: 5,
    backoff: constant,
    initialDelay: 5000
  },
  _ -> continue
}
```

Timeline:
```
Attempt 1: immediate
Attempt 2: wait 5000ms (5s)
Attempt 3: wait 5000ms (5s)
Attempt 4: wait 5000ms (5s)
Attempt 5: wait 5000ms (5s)
```

## Maximum Delay

Prevent extremely long waits:

```reqon
retry: {
  maxAttempts: 10,
  backoff: exponential,
  initialDelay: 1000,
  maxDelay: 30000  // Cap at 30 seconds
}
```

Without cap (exponential):
```
Attempt 8: wait 128000ms (2+ min)
Attempt 9: wait 256000ms (4+ min)
```

With `maxDelay: 30000`:
```
Attempt 8: wait 30000ms (30s)
Attempt 9: wait 30000ms (30s)
```

## Fixed Delay

Override backoff calculation:

```reqon
match response {
  { code: 429, retryAfter: seconds } -> retry {
    maxAttempts: 5,
    delay: seconds * 1000  // Use API-provided delay
  },
  _ -> continue
}
```

## Retry Based on Error Type

### Transient Errors (Should Retry)

```reqon
match response {
  { code: 408 } -> retry,  // Request Timeout
  { code: 429 } -> retry,  // Too Many Requests
  { code: 500 } -> retry,  // Internal Server Error
  { code: 502 } -> retry,  // Bad Gateway
  { code: 503 } -> retry,  // Service Unavailable
  { code: 504 } -> retry,  // Gateway Timeout
  _ -> continue
}
```

### Permanent Errors (Don't Retry)

```reqon
match response {
  { code: 400 } -> abort "Bad request",      // Won't improve
  { code: 401 } -> abort "Unauthorized",     // Need new creds
  { code: 403 } -> abort "Forbidden",        // Permission issue
  { code: 404 } -> skip,                     // Resource gone
  { code: 422 } -> abort "Invalid data",     // Validation error
  _ -> continue
}
```

### Conditional Retry

```reqon
match response {
  // Retry rate limits with longer wait
  { code: 429 } -> retry {
    maxAttempts: 10,
    backoff: exponential,
    initialDelay: 60000  // Start at 1 minute
  },

  // Retry server errors with shorter wait
  { code: 500 } -> retry {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000
  },

  // Retry timeouts with medium wait
  { code: 504 } -> retry {
    maxAttempts: 5,
    backoff: linear,
    initialDelay: 5000
  },

  _ -> continue
}
```

## Retry-After Header

Respect API's `Retry-After` header:

```reqon
match response {
  { code: 429, headers: h } where h["Retry-After"] != null -> retry {
    delay: toNumber(h["Retry-After"]) * 1000
  },
  { code: 429 } -> retry {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 60000
  },
  _ -> continue
}
```

## Retry with Token Refresh

```reqon
action FetchProtectedData {
  get "/protected"

  match response {
    { code: 401 } -> jump RefreshToken then retry,
    { code: 429 } -> retry { maxAttempts: 5 },
    { code: 500 } -> retry { maxAttempts: 3 },
    _ -> continue
  }
}

action RefreshToken {
  post "/auth/refresh" {
    body: { refreshToken: env("REFRESH_TOKEN") }
  }
}
```

## Retry at Source Level

Configure default retry for all requests:

```reqon
source API {
  auth: bearer,
  base: "https://api.example.com",
  retry: {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000
  }
}
```

Override per request:

```reqon
get "/critical-endpoint" {
  retry: {
    maxAttempts: 10  // More attempts for critical requests
  }
}
```

## Choosing the Right Strategy

| Scenario | Recommended Strategy |
|----------|---------------------|
| General API errors | Exponential, 3-5 attempts |
| Rate limiting | Exponential, long initial delay |
| Timeouts | Linear, medium delays |
| Flaky network | Constant, short delays |
| Critical operations | Exponential with high maxAttempts |

## Best Practices

### Start Small, Increase Gradually

```reqon
retry: {
  maxAttempts: 5,
  backoff: exponential,
  initialDelay: 1000,  // Start small
  maxDelay: 60000      // Cap at reasonable max
}
```

### Be Respectful to APIs

```reqon
// Good: respect rate limits
retry: {
  maxAttempts: 5,
  backoff: exponential,
  initialDelay: 5000
}

// Risky: aggressive retries
retry: {
  maxAttempts: 100,
  backoff: constant,
  initialDelay: 100
}
```

### Log Retry Attempts

```reqon
match response {
  { code: 503 } -> {
    store {
      event: "retry",
      code: 503,
      timestamp: now()
    } -> retryLog
    retry { maxAttempts: 3 }
  },
  _ -> continue
}
```

### Have a Fallback

```reqon
match response {
  { error: _ } -> {
    // After max retries, queue for later
    queue failed { item: { request: currentRequest } }
    skip
  },
  _ -> continue
}
```

## Troubleshooting

### Retries Not Happening

Ensure match directive triggers retry:

```reqon
// This triggers retry
match response {
  { error: _ } -> retry,
  _ -> continue
}

// This does NOT retry
get "/data" {
  retry: { maxAttempts: 3 }  // Only triggers on HTTP errors
}
```

### Too Many Retries

Lower maxAttempts or add maxDelay:

```reqon
retry: {
  maxAttempts: 3,
  maxDelay: 30000
}
```

### Retrying Wrong Errors

Be specific about which errors to retry:

```reqon
match response {
  // Only retry specific codes
  { code: 429 } -> retry,
  { code: 503 } -> retry,
  // Don't retry 400, 401, 404, etc.
  _ -> continue
}
```
