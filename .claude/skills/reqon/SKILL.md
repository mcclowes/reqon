---
name: reqon
# prettier-ignore
description: Use when writing or editing .vague files for Reqon declarative API data pipelines
---

# Reqon

Declarative DSL for fetch, map, validate pipelines. File extensions: `.vague` or
`.reqon` (the loader tries `.vague` first).

## Quick Start

```vague
mission SyncData {
  source API { auth: bearer, base: "https://api.example.com" }
  store items: memory("items")

  action Fetch {
    get "/items" { paginate: page(page, 100), until: length(response) == 0 }
    store response -> items { key: .id }
  }

  run Fetch
}
```

## Core Constructs

- `mission` - Pipeline container (sources, stores, schemas, actions, schedule)
- `source` - API: auth, base, headers, validateResponses, rateLimit, circuitBreaker, proxy.
  Auth is bearer/basic/api_key/oauth2/none, all four wired to a provider. A type
  configured without its credentials throws at source init rather than sending an
  unauthenticated request
- `proxy: [...]` - Egress proxy pool, rotated per request; limiter/breaker keyed per IP
- `source Name from "./spec.yaml"` - OAS-based source
- `store` - Storage: `memory("name")`, `file("name")` (writes `.reqon-data/name.json`),
  `postgrest("table")`. `sql()`/`nosql()` have no adapter and throw unless `--dev` falls
  them back to local JSON
- `action` - Pipeline step: fetch, map, validate, store, wait
- `run [A, B] then C` - Parallel then sequential execution
- `match response { Schema -> ..., _ -> skip }` - Pattern matching
- `for item in store where .active { ... }` - Iteration with filter
- `for item in store concurrency 8 { ... }` - Bounded concurrent iteration (default 1)
- `call Source.operationId` - OAS-based fetch by operationId
- `wait { timeout, path, eventFilter, storage }` - Webhook/callback waiting
- `schedule: every N hours` or `schedule: cron "..."` or `schedule: at "datetime"`

## Flow Control

`continue`, `skip`, `abort "msg"`, `retry {...}`, `queue dlq`, `jump Action then retry`

## Reference Files

- [references/syntax.md](references/syntax.md) - Full DSL syntax
- [references/examples.md](references/examples.md) - Complete examples
