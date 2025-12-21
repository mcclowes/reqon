# Circuit Breaker Example

Demonstrates Reqon's circuit breaker pattern for resilient API integrations.

## Key Features

| Feature | Description |
|---------|-------------|
| `circuitBreaker` | Configure circuit breaker per source |
| `failureThreshold` | Failures before opening circuit |
| `resetTimeout` | Wait time before attempting recovery |
| `successThreshold` | Successes needed to close circuit |
| `failureWindow` | Time window for failure counting |
| Fallback chain | Multiple sources with automatic failover |

## Circuit Breaker States

```
CLOSED ──(failures >= threshold)──> OPEN
   ^                                  │
   │                         (resetTimeout)
   │                                  │
   │                                  v
   └──(successes >= threshold)── HALF-OPEN
```

1. **CLOSED**: Normal operation, requests pass through
2. **OPEN**: Fast-fail mode, requests return immediately with circuit open response
3. **HALF-OPEN**: Testing recovery, limited requests allowed

## Configuration

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",

  circuitBreaker: {
    // Open circuit after 3 failures
    failureThreshold: 3,

    // Wait 30 seconds before trying again
    resetTimeout: 30000,

    // Need 2 successes to fully close
    successThreshold: 2,

    // Count failures within 1 minute window
    failureWindow: 60000
  }
}
```

## Detecting Circuit State

When a circuit is open, the response matches a special schema:

```vague
match response {
  CircuitOpen where .circuitOpen == true -> {
    // Handle circuit open - use fallback
  },

  _ -> {
    // Normal response handling
  }
}
```

## Fallback Pattern

```vague
// Primary request
get "/data" { source: PrimaryAPI }

match response {
  CircuitOpen -> {
    // Primary circuit open, try fallback
    get "/data" { source: FallbackAPI }

    match response {
      CircuitOpen -> {
        // Both circuits open, use cache
        get "/data/cached" { source: CacheAPI }
      },
      _ -> continue
    }
  },
  _ -> continue
}
```

## Monitoring Circuit Events

Track circuit state changes for observability:

```vague
store {
  event: "circuit_open",
  service: "PrimaryAPI",
  timestamp: now()
} -> circuit_events { key: now() }
```

## Usage

```bash
# Normal run
node dist/cli.js examples/circuit-breaker/resilient-fetch.vague --verbose

# With environment variables
FALLBACK_API_TOKEN=xxx node dist/cli.js examples/circuit-breaker/resilient-fetch.vague
```

## Best Practices

1. **Set appropriate thresholds**: Balance between fast failure and transient errors
2. **Use increasing timeouts**: Primary should recover before exhausting fallbacks
3. **Log all circuit events**: Essential for debugging and alerting
4. **Monitor fallback usage**: High fallback rates indicate primary issues
5. **Test circuit behavior**: Verify failover works before production
6. **Have a cache fallback**: Stale data is often better than no data
