---
sidebar_position: 2
---

# Retry strategies

Reqon retries transient HTTP failures automatically. You configure the behaviour with a `retry:` block on a fetch step.

## Retry configuration

Attach `retry:` to a `get`, `post`, or other fetch step:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 60000
  }
}
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `maxAttempts` | Total attempts, including the first | 3 |
| `backoff` | Strategy: `exponential`, `linear`, `constant` | `exponential` |
| `initialDelay` | First retry delay (ms) | 1000 |
| `maxDelay` | Cap on the delay between attempts (ms) | 30000 |
| `timeout` | Per-attempt request timeout (ms) | 30000 |

There's no `delay` option; the delay comes from the backoff strategy and `initialDelay`.

## What gets retried

Reqon retries automatically on:

- `429 Too Many Requests` — honouring the server's `Retry-After` header when present
- `5x` server errors

Retries apply to idempotent requests (`get`, `put`, `delete`), or any request carrying an idempotency key. `post` and `patch` aren't retried by default, since re-sending a write the server already committed could duplicate data.

Other responses behave differently:

- `401 Unauthorized` triggers a one-time token refresh when the source has a refresh token, then retries once.
- Other `4xx` responses (`400`, `403`, `404`, `422`) throw immediately and fail the action — retrying won't help.

When attempts are exhausted, the request throws and the action fails (or surfaces to a paused or failed execution you can resume).

## Backoff strategies

### Exponential backoff

Best for most APIs. The delay doubles after each attempt:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000
  }
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

### Linear backoff

The delay increases by a fixed amount:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: linear,
    initialDelay: 2000
  }
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

### Constant backoff

The same delay every time:

```vague
get "/data" {
  retry: {
    maxAttempts: 5,
    backoff: constant,
    initialDelay: 5000
  }
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

## Maximum delay

`maxDelay` prevents extremely long waits:

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

Without a cap, exponential backoff grows quickly:
```
Attempt 8: wait 128000ms (2+ min)
Attempt 9: wait 256000ms (4+ min)
```

With `maxDelay: 30000`:
```
Attempt 8: wait 30000ms (30s)
Attempt 9: wait 30000ms (30s)
```

## Per-attempt timeout

`timeout` aborts a single attempt that hangs, so a slow request doesn't block the whole retry budget:

```vague
get "/data" {
  retry: {
    maxAttempts: 3,
    timeout: 10000  // Give up on an attempt after 10s, then retry
  }
}
```

## Retrying on response contents

The fetch `retry:` block handles HTTP-level failures. To re-run work based on a successful response body — for example, an API that returns `{ pending: true }` while a job finishes — use the `retry` flow directive in a `match` arm. That replays the whole action:

```vague
action FetchResult {
  get "/jobs/123"

  match response {
    _ where response.pending -> retry { maxAttempts: 5, backoff: exponential, initialDelay: 1000 },
    _ -> store response -> results { key: .id }
  }
}
```

See [Flow control directives](./flow-control) for the directive form.

## Choosing the right strategy

| Scenario | Recommended strategy |
|----------|---------------------|
| General API errors | Exponential, 3-5 attempts |
| Rate limiting | Exponential, longer initial delay |
| Timeouts | Linear, medium delays |
| Flaky network | Constant, short delays |
| Critical operations | Exponential with higher `maxAttempts` |

## Scheduled missions

Retrying a whole mission run is separate from request-level retries. A schedule's retry block uses different keys — `maxRetries` and `delaySeconds`:

```vague
schedule: every 1 hours {
  retry: {
    maxRetries: 3,
    delaySeconds: 60
  }
}
```

See [Scheduling overview](../scheduling/overview) for details.

## Best practices

### Start small, increase gradually

```vague
retry: {
  maxAttempts: 5,
  backoff: exponential,
  initialDelay: 1000,  // Start small
  maxDelay: 60000      // Cap at a reasonable max
}
```

### Be respectful to APIs

```vague
// Good: back off generously
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

## Troubleshooting

### Retries not happening

Retries apply to `429` and `5xx` on idempotent requests. A `post` or `patch` isn't retried unless it carries an idempotency key, and `4xx` responses other than `401` throw immediately:

```vague
// Retried automatically on 429 / 5xx
get "/data" {
  retry: { maxAttempts: 3 }
}
```

### Too many retries

Lower `maxAttempts` or cap the wait with `maxDelay`:

```vague
retry: {
  maxAttempts: 3,
  maxDelay: 30000
}
```
