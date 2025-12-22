---
sidebar_position: 6
---

# Circuit Breaker

The circuit breaker pattern prevents cascading failures when an API is experiencing problems. Reqon includes a built-in circuit breaker for robust error handling.

## How it works

```
     ┌────────────────────────────────────────┐
     │                                        │
     ▼                                        │
┌─────────┐  failures > threshold  ┌─────────┐ │
│ CLOSED  │ ───────────────────────│  OPEN   │ │
│ (normal)│                        │ (fail)  │ │
└────┬────┘                        └────┬────┘ │
     │                                  │      │
     │        ┌───────────┐             │      │
     │        │ HALF_OPEN │◄────────────┘      │
     │        │  (test)   │   after timeout   │
     │        └─────┬─────┘                   │
     │              │                          │
     │   successes > threshold                 │
     └──────────────┴──────────────────────────┘
```

**States:**
- **CLOSED**: Normal operation, requests pass through
- **OPEN**: Circuit tripped, requests fail immediately
- **HALF_OPEN**: Testing if service recovered

## Configuration

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2,
    failureWindow: 60000
  }
}
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `failureThreshold` | Failures before opening circuit | 5 |
| `resetTimeout` | Time before trying half-open (ms) | 30000 |
| `successThreshold` | Successes needed to close circuit | 2 |
| `failureWindow` | Window for counting failures (ms) | 60000 |

## States explained

### Closed state

Normal operation:

```vague
// All requests pass through normally
get "/data"  // Success
get "/data"  // Success
get "/data"  // Failure (1)
get "/data"  // Failure (2)
get "/data"  // Success - counter resets
```

Failures are counted within the `failureWindow`. Successes reset the counter.

### Open state

When `failureThreshold` is reached:

```vague
// After 5 consecutive failures...
get "/data"  // Immediately fails - circuit is OPEN
get "/data"  // Immediately fails - no actual request made
```

All requests fail fast without calling the API.

### Half-open state

After `resetTimeout`:

```vague
// After 30 seconds...
get "/data"  // Actually sent - testing if API is back

// If success:
get "/data"  // Sent - need 2 successes total
// After 2 successes, circuit CLOSES

// If failure:
// Circuit goes back to OPEN
```

## Error handling with circuit breaker

```vague
action FetchWithCircuitBreaker {
  get "/data"

  match response {
    { error: "circuit_open" } -> {
      // Circuit is open - API is down
      store { status: "api_down", timestamp: now() } -> statusLog
      abort "API unavailable - circuit breaker open"
    },
    { error: e } -> {
      // Other errors - may trip circuit
      abort e
    },
    _ -> continue
  }
}
```

## Combining with retry

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  }
}

action RobustFetch {
  get "/data" {
    retry: {
      maxAttempts: 3,
      backoff: exponential
    }
  }

  match response {
    { error: "circuit_open" } -> skip,  // Don't retry if circuit is open
    { error: _ } -> abort "Request failed",
    _ -> store response -> data { key: .id }
  }
}
```

Order of operations:
1. Check if circuit is open → fail fast if yes
2. Make request
3. If fails, retry logic kicks in
4. Each failure counts toward circuit breaker
5. After max retries, may trip circuit

## Combining with rate limiting

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  }
}
```

Both work together:
- Rate limiter controls request pacing
- Circuit breaker handles API failures

## Per-source circuit breakers

Each source has its own circuit breaker:

```vague
mission MultiSourceSync {
  source ReliableAPI {
    auth: bearer,
    base: "https://reliable.api.com",
    circuitBreaker: {
      failureThreshold: 10  // More tolerant
    }
  }

  source FlakyAPI {
    auth: bearer,
    base: "https://flaky.api.com",
    circuitBreaker: {
      failureThreshold: 3,  // Trip quickly
      resetTimeout: 60000   // Wait longer before retry
    }
  }

  action FetchBoth {
    // Each source's circuit is independent
    get ReliableAPI "/data"
    get FlakyAPI "/data"
  }
}
```

## Monitoring circuit state

```vague
action MonitoredFetch {
  get "/data"

  match response {
    { error: "circuit_open" } -> {
      store {
        event: "circuit_open",
        source: "API",
        timestamp: now()
      } -> circuitEvents
      skip
    },
    { error: e } -> {
      store {
        event: "failure",
        error: e,
        timestamp: now()
      } -> circuitEvents
      abort e
    },
    _ -> {
      store {
        event: "success",
        timestamp: now()
      } -> circuitEvents
      continue
    }
  }
}
```

## Fallback patterns

### Fallback to cache

```vague
action FetchWithFallback {
  get "/data"

  match response {
    { error: "circuit_open" } -> {
      // Use cached data
      for item in cachedData {
        store item -> data { key: .id }
      }
      continue
    },
    { data: items } -> {
      // Update cache
      for item in items {
        store item -> cachedData { key: .id }
        store item -> data { key: .id }
      }
    },
    _ -> abort "Unexpected response"
  }
}
```

### Fallback to secondary source

```vague
mission FallbackSync {
  source Primary { circuitBreaker: { failureThreshold: 3 } }
  source Secondary { circuitBreaker: { failureThreshold: 5 } }

  action FetchWithFallback {
    get Primary "/data"

    match response {
      { error: "circuit_open" } -> {
        // Primary is down, try secondary
        get Secondary "/data"
        store response -> data { key: .id }
      },
      { data: _ } -> store response.data -> data { key: .id },
      _ -> abort "Both sources failed"
    }
  }
}
```

## Best practices

### Configure based on API behavior

```vague
// For stable APIs
circuitBreaker: {
  failureThreshold: 10,
  resetTimeout: 30000
}

// For flaky APIs
circuitBreaker: {
  failureThreshold: 3,
  resetTimeout: 60000
}

// For critical APIs (fail fast)
circuitBreaker: {
  failureThreshold: 2,
  resetTimeout: 10000
}
```

### Use with error handling

```vague
action RobustFetch {
  get "/data"

  match response {
    { error: "circuit_open" } -> {
      // Log and handle gracefully
      store { event: "circuit_open" } -> logs
      skip
    },
    _ -> continue
  }
}
```

### Set appropriate timeouts

```vague
// For fast recovery APIs
circuitBreaker: {
  resetTimeout: 10000  // 10 seconds
}

// For slow recovery APIs
circuitBreaker: {
  resetTimeout: 300000  // 5 minutes
}
```

### Consider failure window

```vague
// For burst-tolerant scenarios
circuitBreaker: {
  failureThreshold: 5,
  failureWindow: 60000  // 1 minute window
}

// For strict scenarios
circuitBreaker: {
  failureThreshold: 3,
  failureWindow: 10000  // 10 second window
}
```

## Troubleshooting

### Circuit trips too often

Increase threshold or window:

```vague
circuitBreaker: {
  failureThreshold: 10,  // More tolerance
  failureWindow: 120000  // Longer window
}
```

### Circuit stays open too long

Decrease reset timeout:

```vague
circuitBreaker: {
  resetTimeout: 10000  // Try sooner
}
```

### False positives

Ensure only real failures count:

```vague
match response {
  { code: 404 } -> skip,  // Not a failure
  { code: 400 } -> abort "Bad request",  // Not a failure
  { code: 500 } -> abort "Server error",  // This counts as failure
  _ -> continue
}
```
