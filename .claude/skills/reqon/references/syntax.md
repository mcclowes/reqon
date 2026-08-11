# Reqon DSL Syntax Reference

## Mission Structure

```text
mission MissionName {
  // Sources (API connections)
  source SourceName { ... }

  // Stores (data persistence)
  store storeName: type("identifier")

  // Schemas (type definitions)
  schema SchemaName { ... }

  // Actions (pipeline steps)
  action ActionName { ... }

  // Pipeline execution
  run ActionA then ActionB
}
```

## Sources

### Authentication Types

```vague
// Bearer token (from env var)
source API {
  auth: bearer,
  base: "https://api.example.com",
  headers: { "Accept": "application/json" }
}

// API key. Sent as a header (default X-API-Key) or, with
// apiKeyLocation: "query" in the credentials, as a query parameter.
source API {
  auth: api_key,
  base: "https://api.example.com"
}

// Basic auth. Sends base64(username:password) in the Authorization header.
source API {
  auth: basic,
  base: "https://api.example.com"
}

// OAuth2. Credentials are never inline: they come from a --auth JSON file
// keyed by source name, or REQON_{SOURCE}_* env vars.
source API {
  auth: oauth2,
  base: "https://api.example.com"
}
```

A source block accepts only `auth`, `base`, `headers`, `validateResponses`,
`rateLimit`, `circuitBreaker`, and `proxy`. There is no inline `oauth:` block.

**All four auth types are wired to a provider.** An auth type configured without
the credentials it needs (a `bearer` with no token, a `basic` with no password)
throws when the source is initialized, rather than sending an unauthenticated
request. Set `auth: none` if that's what you mean.

### Rate Limiting

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: throttle,   // or pause (default) / fail — bare identifier, not a string
    maxWait: 60,          // seconds
    notifyAt: 10,         // warn after waiting this many seconds
    fallbackRpm: 60       // requests per minute fallback when no headers
  }
}
```

When you know the server's limiter, model it so throttle uses the burst
allowance instead of pacing flat. `refill` is tokens per second; the model
self-calibrates downward on 429s and decays back up when they stop:

```vague
source API {
  auth: none,
  base: "https://api.example.com",
  rateLimit: {
    strategy: throttle,
    model: { type: tokenBucket, capacity: 5000, refill: 300, safety: 0.9 }
  }
}
```

### Egress Proxies

Route a source's requests through one or more proxies. A list is a pool,
rotated round-robin per request attempt, so a retry after a 429 leaves from a
different IP than the attempt that earned it.

```vague
source API {
  auth: none,
  base: "https://api.example.com",
  proxy: env("PROXY_URL")
}

source Pooled {
  auth: none,
  base: "https://api.example.com",
  proxy: [env("PROXY_A"), env("PROXY_B"), "http://user:pass@host:3128"]
}
```

Rate limit and circuit breaker state are keyed per proxy, so each egress IP gets
its own budget and one failing proxy opens only its own circuit. Combined with
`fallbackRpm`, a source's total rate is `fallbackRpm x pool size`.

An entry resolving to an empty value (typically an unset env var) is an error,
not a shorter pool: quietly dropping a proxy would concentrate the run's whole
rate onto the survivors.

Requires the optional peer dependency: `npm install undici`.

## Stores

```vague
store items: memory("items")           // In-memory, lost on exit
store items: file("items")             // JSON at .reqon-data/items.json
store items: postgrest("items_table")  // PostgREST/Supabase — the production option
```

`sql()` and `nosql()` parse but have no database adapter behind them: `sql()`
works only with a PostgREST backend wired up, `nosql()` has no implementation at
all, and both throw unless `--dev` opts into the local JSON file fallback.
Prefer `postgrest()`.

## Schemas

```vague
schema User {
  id: int,
  name: string,
  email: string?,       // Optional field
  created_at: date,
  tags: array,
  metadata: object
}
```

Types checked when matching: `string`, `int` (`integer`), `decimal` (`number`,
`float`, `double`), `boolean` (`bool`), `date` (`datetime`), `any`. Anything else
(`array`, `object`, a nested schema name) parses and is matched permissively — it
always passes.

## HTTP Operations

### Basic Fetch

```vague
get "/users"
post "/users" { body: { "name": "John" } }
put "/users/{id}" { body: { "name": "Jane" } }
delete "/users/{id}"
```

### Full Options

```vague
get "/users" {
  source: APISource,
  body: { "status": "active" },
  headers: { "X-Custom": "value" },

  // Pagination. Param name and page size are both required; the trailing
  // string args are positional:
  //   cursor(param, size, "cursorPath"[, "itemsPath"])
  //   offset|page(param, size[, "itemsPath"])
  paginate: page(page, 100),
  paginate: cursor(after, 50, "meta.next", "data"),
  paginate: offset(offset, 50, "data"),

  until: length(response) == 0,        // Stop condition

  // Retry configuration
  retry: {
    maxAttempts: 3,
    backoff: exponential,    // bare identifier, not a string: constant | linear | exponential
    initialDelay: 1000,      // ms
    maxDelay: 60000,         // ms
    timeout: 30000           // ms, per attempt
  },

  // Treat these statuses as a non-error result rather than throwing
  allow: [404, 410],

  // Resumable, memory-bounded backfill (needs a durable execution log)
  backfill: true,

  // Incremental sync
  since: lastSync
}
```

## Pattern Matching

```vague
match response {
  // Match array of schema type
  [UserSchema] -> { store response -> users { key: .id } },

  // Match single schema type
  ErrorSchema -> abort "API error",

  // Match with condition
  _ where .status == "rate_limited" -> retry { maxAttempts: 3 },

  // Wildcard
  _ -> skip
}
```

## Loops and Iteration

```vague
// Basic loop
for user in users {
  // process each user
}

// Loop with filter
for user in users where .active == true {
  // process only active users
}

// Loop with complex filter
for item in items where .status == "pending" and .priority > 5 {
  // process filtered items
}

// Concurrent loop - up to 8 iterations in flight
for id in ids concurrency 8 {
  get "/entry/{id.id}"
  store response -> entries { key: .id, upsert: true }
}

// concurrency goes after the where clause
for item in items where .active concurrency 4 {
  // ...
}
```

Loops are sequential by default. `concurrency N` bounds how many iterations run
at once, which is what lets one worker use a whole proxy pool or a generous rate
limit.

Notes:

- Each iteration already has its own scope, so `response` and the loop variable
  stay isolated. Stores are shared, so iterations writing the same key are
  last-writer-wins; give them disjoint keys.
- On failure the loop stops taking new items, lets in-flight iterations finish,
  then rethrows the first error.
- Attaching the debugger forces sequential iteration so stepping stays
  deterministic.

## Mapping

```vague
map input -> OutputSchema {
  id: .id,
  fullName: .firstName + " " + .lastName,
  status: match .state {
    "active" => "enabled",
    "inactive" => "disabled",
    _ => "unknown"
  },
  createdAt: .created_at,
  tags: .labels
}
```

## Validation

```vague
validate response {
  assume length(.name) > 0,
  assume .age >= 0,
  assume .status in ["active", "pending"]
}

// Optional `or` block: run these steps on failure instead of throwing.
// It takes action steps, not flow directives — `queue dlq` is a parse error here.
validate response {
  assume .amount > 0
} or {
  store response -> rejects { key: .id }
}
```

There is no `contains` operator. The binary operators are `+ - * / == != < >
<= >=` and `in` (array membership, substring, or object own-key presence).

## Store Operations

```vague
// Basic store
store response -> items { key: .id }

// Upsert mode
store response -> items { key: .id, upsert: true }

// Partial update
store response -> items { key: .id, partial: true }
```

## Pipeline Execution

```vague
// Sequential
run ActionA then ActionB then ActionC

// Parallel then sequential
run [ActionA, ActionB] then ActionC

// Multiple parallel groups
run [ActionA, ActionB] then [ActionC, ActionD] then ActionE
```

## Flow Control Directives

| Directive | Description |
|-----------|-------------|
| `continue` | Proceed to next step |
| `skip` | Skip current loop item |
| `abort "msg"` | Stop mission with error |
| `retry {...}` | Retry current operation |
| `queue storeName` | Send to dead letter queue |
| `jump ActionName then retry` | Execute action then retry |

**Where they're valid:** only directly after a `match` arm's `->`. They are not
action steps, so they can't sit on their own in an action body, a `for` body, a
match arm's `{ }` block, or a validate `or` block.

```vague
match response {
  ErrorSchema -> abort "API error",
  _ where .status == "rate_limited" -> retry { maxAttempts: 3 },
  _ -> skip
}
```

A for loop takes its own error policy in the header instead:

```vague
for item in items onError continue { ... }
for item in items onError abort { ... }
for item in items onError queue dlq { ... }   // failed items land in the dlq store
```

## Action Steps

The steps valid anywhere a step goes (action body, `for` body, `match` arm block,
validate `or` block): `get`/`post`/`put`/`patch`/`delete`, `call`, `for`, `map`,
`apply`, `validate`, `store`, `match`, `let`, `wait`, `pause`.

## Built-in Functions

Aggregation / arrays:
- `length(array)` - Array (or string) length
- `count(array)` - Same as length for arrays
- `sum(array)` - Sum of a numeric array
- `first(array)` / `last(array)` - First / last element
- `range(end)` / `range(start, end)` - Build a numeric array (end-exclusive)

Numbers:
- `abs(n)`, `round(n)`, `floor(n)`, `ceil(n)`
- `max(a, b, ...)` / `min(a, b, ...)` - Also accept a single array argument
- `parseNumber(x)` - Coerce a value (e.g. a numeric string) to a number; `null` if unparseable

Strings:
- `concat(a, b, ...)` - Concatenate arguments as strings (`null`/`undefined` → `""`)

Time:
- `now()` - Current time as an ISO-8601 **string**
- `timestamp()` - Current time as epoch **milliseconds** (a number) — use this for
  date arithmetic; `now() - 86400000` throws because `now()` is a string
- `fromUnix(seconds)` - Convert Unix epoch **seconds** to an ISO-8601 string

Other:
- `env("VAR_NAME")` - Environment variable (name must be a string literal)

> There is **no** `exists()`, and a store cannot be read inside an expression:
> `store[key]` lookups, `length(store)`, and `sum(store.field)` do not work
> (a store is not a value in an expression). Read a store only by iterating it
> with `for x in store where ...`.

## Expressions

```vague
// Arithmetic
.price * .quantity
.total + .tax

// String concatenation
.firstName + " " + .lastName
"prefix_" + .id

// Comparisons
.age >= 18
.status == "active"
.count > 0 and .count < 100

// Property access
.user.name
.items[0].id
```

## Webhook/Callback Waiting

```vague
wait {
  timeout: 60000,                           // Required: ms to wait
  path: "/webhooks/callback",               // Optional: specific path
  expectedEvents: 3,                        // Optional: wait for N events
  eventFilter: .type == "payment.completed", // Optional: filter events
  storage: {
    target: events_store,
    key: .id
  },
  retry: {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000
  }
}
```

## Scheduling

```vague
// Interval-based
schedule: every 6 hours
schedule: every 30 minutes
schedule: every 1 days

// Cron-based
schedule: cron "0 */6 * * *"
schedule: cron "30 9 * * 1-5"

// One-time
schedule: at "2025-01-25T15:00:00Z"

// With options
schedule: every 6 hours {
  timezone: "America/New_York",
  maxConcurrency: 1,
  skipIfRunning: true,
  retry: {
    maxRetries: 3,
    delaySeconds: 60
  }
}
```
