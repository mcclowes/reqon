---
name: reqon
# prettier-ignore
description: Reqon DSL for declarative fetch, map, validate pipelines with HTTP orchestration
---

# Reqon

Declarative DSL for API data pipelines. File extension: `.vague`

## Quick Start

```
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

- `mission` - Pipeline container with sources, stores, schemas, actions
- `source` - API config: auth (bearer/basic/api_key/oauth2), base URL, headers, rateLimit
- `store` - Storage: `memory("name")`, `file("path")`, `sql("table")`
- `schema` - Type definitions for response matching
- `action` - Pipeline step with fetch/map/validate/store
- `run [A, B] then C` - Parallel then sequential execution

## HTTP Fetch

```
get "/path" {
  source: SourceName,
  body: { "key": "value" },
  paginate: page(page, 100),      // or cursor(.next_cursor) or offset(offset, 50)
  until: length(response) == 0,
  retry: { maxAttempts: 3, backoff: "exponential", initialDelay: 1000 }
}
```

## Pattern Matching

```
match response {
  [Schema] -> { store response -> items { key: .id } },
  ErrorSchema -> retry { maxAttempts: 3 },
  _ where .status == "error" -> abort "Failed",
  _ -> skip
}
```

## Transformation

```
for item in items where .active == true {
  map item -> OutputSchema {
    id: .id,
    name: .title,
    status: match .state { "open" => "active", _ => "inactive" }
  }
  validate response { assume length(.name) > 0 }
  store response -> output { key: .id, upsert: true }
}
```

## Flow Control

- `continue` - Proceed to next step
- `skip` - Skip current item in loop
- `abort "message"` - Stop mission with error
- `retry { maxAttempts, backoff, initialDelay }` - Retry current operation
- `queue storeName` - Send to dead letter queue
- `jump ActionName then retry` - Execute action then retry

## Reference Files

See [references/](references/) for detailed syntax and examples.
