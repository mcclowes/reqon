---
sidebar_position: 7
---

# Egress proxies

A source can route its requests through a proxy, or rotate across a pool of
them. This exists for one job: spreading a bulk read across several egress IPs
so a per-IP rate limit isn't the ceiling on the whole run.

Proxy support needs an optional peer dependency:

```bash
npm install undici
```

## Single proxy

```vague
source API {
  auth: none,
  base: "https://api.example.com",
  proxy: env("PROXY_URL")
}
```

The value is an ordinary expression, resolved once at mission start. Credentials
in the URL are fine and never appear in logs, events, or limiter keys:

```vague
proxy: "http://user:pass@proxy.internal:3128"
```

## Proxy pools

A list is a pool, rotated round-robin per **request attempt**:

```vague
source FPL {
  auth: none,
  base: "https://fantasy.premierleague.com/api",
  proxy: [
    env("PROXY_1"),
    env("PROXY_2"),
    env("PROXY_3"),
    env("PROXY_4")
  ]
}
```

Because rotation happens per attempt rather than per request, a retry after a
429 leaves from a different IP than the attempt that earned it.

## Per-proxy resilience state

Rate limit and circuit breaker state are keyed per proxy, not per source. This
is what makes a pool worth having:

- **Rate limits.** Each proxy gets its own budget. With
  `rateLimit: { fallbackRpm: 30 }` and four proxies, the source's total rate is
  120 requests per minute, thirty per IP.
- **Circuit breakers.** A proxy that starts failing opens only its own circuit.
  The rest of the pool keeps working, and the bad proxy is retried after
  `resetTimeout`.

```vague
source API {
  auth: none,
  base: "https://api.example.com",
  proxy: [env("PROXY_A"), env("PROXY_B")],
  rateLimit: { strategy: throttle, fallbackRpm: 30 },
  circuitBreaker: { failureThreshold: 5, resetTimeout: 120 }
}
```

## Failure modes

**An unset env var is an error, not a smaller pool.** If `env("PROXY_3")`
resolves to nothing, the mission fails at startup naming the offending index.
Silently dropping a proxy would concentrate the run's whole request rate onto
the survivors, which is the exact failure a pool exists to prevent.

**A proxy that can't be dialled fails the request.** Reqon never falls back to
direct egress, which would leak the real IP the pool exists to hide. It also
doesn't burn retries on it, since an unreachable proxy is a configuration fault
rather than a transient error.

**A malformed proxy URL fails at mission start**, not thousands of requests into
a run.

## Pairing with loop concurrency

A pool is only useful if something drives it. A sequential loop issues one
request at a time no matter how many proxies you have, so pair it with
[`concurrency`](../dsl-syntax/for-loops.md#concurrency):

```vague
for entry in shard concurrency 8 {
  get "/entry/{entry.id}/history/"
  store response -> managers { key: .id, upsert: true }
}
```

A reasonable starting point is roughly twice the pool size: enough to keep every
proxy busy while one waits on the wire, low enough that the per-proxy throttle
paces the run rather than the socket count.

See [examples/fpl-sharded](https://github.com/mcclowes/reqon/tree/main/examples/fpl-sharded)
for the full pattern, including how workers are sharded.

## Do you need proxies at all?

Often not. Check first whether the data comes back in one request, and whether
the polite version of the job (one IP, honour `Retry-After`, run overnight,
cache what can't change) fits your schedule. Spreading requests across IPs to
get around a per-IP limit is deliberately routing around a control the API owner
put there, so make it a considered choice rather than a default.
