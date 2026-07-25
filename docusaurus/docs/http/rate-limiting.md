---
sidebar_position: 5
---

# Rate limiting

Reqon includes an adaptive rate limiter that learns from API responses and respects standard rate limit headers.

## Source-level configuration

Rate limiting is configured on a source, and applies to every request made through it:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause
  }
}
```

## Rate limit options

| Option | Description | Default |
|--------|-------------|---------|
| `strategy` | How to handle limits: `pause`, `throttle`, or `fail` (unquoted) | `pause` |
| `maxWait` | Maximum time to wait, in **seconds**, before giving up | 300 |
| `fallbackRpm` | Requests per minute to assume when the API sends no rate limit headers | 60 |

There's no `requestsPerMinute` option, and there's no `adaptive` flag. The limiter is adaptive by default: it reads rate limit headers from each response and paces itself accordingly. `fallbackRpm` only kicks in when an API sends no headers.

The strategy value is an unquoted identifier (`strategy: pause`), not a string (`strategy: "pause"` is a parse error).

## Strategies

### Pause strategy

Wait when the rate limit is reached:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause
  }
}
```

When the limit is reached, Reqon:

1. Pauses execution.
2. Waits until the rate limit window resets (or `maxWait` seconds elapse, after which it throws).
3. Continues with the next request.

### Throttle strategy

Slow down requests proactively to stay under the limit:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: throttle,
    fallbackRpm: 60
  }
}
```

Throttle spaces requests out. When the API reports remaining quota and a reset time, requests are spread evenly across the remaining window; otherwise `fallbackRpm` sets the pace.

### Fail strategy

Throw an error when the limit is reached instead of waiting:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: fail
  }
}
```

## Response header support

Reqon automatically reads standard rate limit headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed |
| `X-RateLimit-Remaining` | Requests remaining in window |
| `X-RateLimit-Reset` | When the window resets |
| `Retry-After` | Seconds to wait before retrying |

`RateLimit-*` and `X-Rate-Limit-*` header variants are recognised too.

### Header parsing

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705752000
Retry-After: 60
```

On a 429 with a `Retry-After`, Reqon waits for the indicated time (subject to `maxWait`), then continues. You don't need to hand-write retry logic for rate limits; the limiter handles the pause for you.

## Per-endpoint tracking

The limiter tracks rate limit state per endpoint automatically, learning each endpoint's limit from its response headers. There's no per-request rate limit option. To apply different configured strategies, define separate sources:

```vague
mission APISync {
  source API {
    auth: bearer,
    base: "https://api.example.com",
    rateLimit: { strategy: pause }
  }

  source HeavyAPI {
    auth: bearer,
    base: "https://api.example.com",
    rateLimit: { strategy: throttle, fallbackRpm: 10 }
  }

  action FetchUsers {
    get "/users" { source: API }
  }

  action FetchReports {
    get "/reports" { source: HeavyAPI }
  }
}
```

## Combining with pagination

```vague
get "/items" {
  paginate: offset(offset, 100),
  until: length(response.items) == 0
}
```

Rate limiting applies to each page request, not just the action as a whole.

## Combining with retry

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause
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

1. The rate limiter checks whether the request is allowed.
2. If not, it pauses (based on strategy).
3. The request is made.
4. If it fails, retry logic takes over.

## Multiple sources with different limits

```vague
mission MultiSourceSync {
  source HighVolumeAPI {
    auth: bearer,
    base: "https://high-volume.api.com",
    rateLimit: { strategy: throttle, fallbackRpm: 1000 }
  }

  source LowVolumeAPI {
    auth: bearer,
    base: "https://limited.api.com",
    rateLimit: { strategy: throttle, fallbackRpm: 10 }
  }

  action FetchBoth {
    // Each source respects its own configuration
    get "/items" { source: HighVolumeAPI }
    get "/items" { source: LowVolumeAPI }
  }
}
```

## Best practices

### Use pause for critical syncs

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause  // Ensures completion, waiting when needed
  }
}
```

### Use throttle for background jobs

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: throttle,
    fallbackRpm: 60  // Smooth, predictable pacing
  }
}
```

### Set a reasonable maxWait

`maxWait` is in seconds, so 300 is five minutes:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause,
    maxWait: 300  // Give up after 5 minutes of waiting
  }
}
```

### Combine with a circuit breaker

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  }
}
```

## Troubleshooting

### Still hitting rate limits

If the API sends no rate limit headers, the limiter falls back to `fallbackRpm`. Lower it to slow down:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: throttle,
    fallbackRpm: 30
  }
}
```

### Requests too slow

If throttle is pacing too conservatively, switch to pause, which only waits when the limit is actually reached:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause
  }
}
```

### Inconsistent API limits

The limiter already adapts to response headers automatically, so you don't need to do anything special for APIs whose limits vary. If an API sends no headers at all, set `fallbackRpm` to a safe baseline.
