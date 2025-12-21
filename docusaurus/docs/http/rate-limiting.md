---
sidebar_position: 5
---

# Rate Limiting

Reqon provides adaptive rate limiting that learns from API responses and respects rate limit headers.

## Source-Level Configuration

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"
  }
}
```

## Rate Limit Options

| Option | Description | Default |
|--------|-------------|---------|
| `requestsPerMinute` | Maximum requests per minute | 60 |
| `strategy` | How to handle limits | `"pause"` |
| `maxWait` | Maximum wait time (ms) | 60000 |

## Strategies

### Pause Strategy

Wait when rate limit is reached:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"
  }
}
```

When limit is reached:
1. Reqon pauses execution
2. Waits until rate limit window resets
3. Continues with next request

### Throttle Strategy

Slow down requests proactively:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "throttle"
  }
}
```

Automatically spaces requests to stay within limits.

### Fail Strategy

Throw error when limit is reached:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "fail"
  }
}
```

Use with error handling:

```vague
action FetchWithRateLimitHandling {
  get "/data"

  match response {
    { error: "rate_limit" } -> retry { delay: 60000 },
    _ -> continue
  }
}
```

## Response Header Support

Reqon automatically reads standard rate limit headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed |
| `X-RateLimit-Remaining` | Requests remaining in window |
| `X-RateLimit-Reset` | When the window resets |
| `Retry-After` | Seconds to wait before retrying |

### Header Parsing

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705752000
Retry-After: 60
```

Reqon will automatically:
1. Pause for 60 seconds (from `Retry-After`)
2. Update internal limit tracking
3. Retry the request

## Adaptive Rate Limiting

Reqon learns from API responses:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 100,  // Initial estimate
    strategy: "pause",
    adaptive: true  // Learn from responses
  }
}
```

With `adaptive: true`:
- Reqon monitors response headers
- Adjusts request pacing dynamically
- Backs off before hitting limits

## Per-Endpoint Rate Limits

Some APIs have different limits per endpoint:

```vague
mission APISync {
  source API {
    auth: bearer,
    base: "https://api.example.com",
    rateLimit: { requestsPerMinute: 100 }
  }

  action FetchUsers {
    // Standard endpoint - uses default limit
    get "/users"
  }

  action FetchReports {
    // Heavy endpoint - add delay
    get "/reports" {
      rateLimit: { requestsPerMinute: 10 }
    }
  }
}
```

## Combining with Pagination

```vague
get "/items" {
  paginate: offset(offset, 100),
  until: length(response.items) == 0
}
```

Rate limiting applies to each page request, not just the action.

## Combining with Retry

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
  get "/data" {
    retry: {
      maxAttempts: 5,
      backoff: exponential
    }
  }
}
```

Order of operations:
1. Rate limiter checks if request is allowed
2. If not, pauses (based on strategy)
3. Request is made
4. If fails, retry logic kicks in

## Handling 429 Responses

Even with rate limiting, you might hit limits. Handle gracefully:

```vague
action RobustFetch {
  get "/data"

  match response {
    { code: 429 } -> retry {
      maxAttempts: 5,
      backoff: exponential,
      initialDelay: 60000  // Wait 1 minute
    },
    _ -> continue
  }
}
```

## Multiple Sources with Different Limits

```vague
mission MultiSourceSync {
  source HighVolumeAPI {
    auth: bearer,
    base: "https://high-volume.api.com",
    rateLimit: { requestsPerMinute: 1000 }
  }

  source LowVolumeAPI {
    auth: bearer,
    base: "https://limited.api.com",
    rateLimit: { requestsPerMinute: 10 }
  }

  action FetchBoth {
    // These respect their respective limits
    get HighVolumeAPI "/items"
    get LowVolumeAPI "/items"
  }
}
```

## Monitoring Rate Limits

Track rate limit status:

```vague
action MonitoredFetch {
  get "/data"

  match response {
    { code: 429, headers: h } -> {
      store {
        endpoint: "/data",
        hitLimit: true,
        retryAfter: h["Retry-After"],
        timestamp: now()
      } -> rateLimitLogs
      retry { delay: h["Retry-After"] * 1000 }
    },
    _ -> continue
  }
}
```

## Best Practices

### Start Conservative

```vague
// Good: start below the actual limit
source API {
  rateLimit: { requestsPerMinute: 50 }  // API allows 60
}

// Risky: at or above the limit
source API {
  rateLimit: { requestsPerMinute: 60 }  // Exactly at limit
}
```

### Use Pause for Critical Syncs

```vague
source API {
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"  // Ensures completion
  }
}
```

### Use Throttle for Background Jobs

```vague
source API {
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "throttle"  // Smooth, predictable pacing
  }
}
```

### Set Reasonable maxWait

```vague
source API {
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause",
    maxWait: 300000  // 5 minutes max wait
  }
}
```

### Combine with Circuit Breaker

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

## Troubleshooting

### Still Hitting Rate Limits

Lower your configured limit:

```vague
source API {
  rateLimit: {
    requestsPerMinute: 30,  // Lower than API limit
    strategy: "pause"
  }
}
```

### Requests Too Slow

Check if throttle strategy is too aggressive:

```vague
// If using throttle, switch to pause
source API {
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"  // Only waits when needed
  }
}
```

### Inconsistent API Limits

Use adaptive mode:

```vague
source API {
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause",
    adaptive: true
  }
}
```
