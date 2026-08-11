# Reqon

A declarative DSL for fetch, map, validate pipelines - built on [Vague](https://github.com/mcclowes/vague).

## What is Reqon?

Reqon lets you define data synchronization pipelines in a readable, declarative language. Think of it like Temporal.io, but with a focus on API data fetching and transformation.

Reqon uses Vague schemas directly for constrained fixture generation, runtime
validation, dataset reports, and golden-output comparisons.

## Example

```vague
mission SyncXeroInvoices {
  source Xero {
    auth: oauth2,
    base: "https://api.xero.com/api.xro/2.0"
  }

  store invoices: memory("invoices")
  store normalized: memory("normalized")

  action FetchInvoices {
    get "/Invoices" {
      paginate: offset(page, 100),
      until: length(response.Invoices) == 0
    }

    store response.Invoices -> invoices {
      key: .InvoiceID,
      partial: true
    }
  }

  action NormalizeInvoices {
    for invoice in invoices {
      map invoice -> StandardInvoice {
        id: .InvoiceID,
        amount: .Total,
        status: match .Status {
          "PAID" => "paid",
          "AUTHORISED" => "approved",
          _ => "pending"
        }
      }

      validate response {
        assume .amount >= 0
      }

      store response -> normalized { key: .id }
    }
  }

  run FetchInvoices then NormalizeInvoices
}
```

## Installation

Reqon is published as `reqon-dsl`; installing it adds two binaries, `reqon` (the
CLI) and `reqon-mcp` (the Model Context Protocol server). Needs Node.js 22 or
later.

```bash
npm install reqon-dsl
```

## Usage

### CLI

```bash
reqon sync-invoices.vague --verbose
reqon sync-invoices.vague --auth ./credentials.json
reqon sync-invoices.vague --dry-run
reqon seed-fixtures.vague --report ./report.html
reqon reconciliation.vague --compare ./golden.json
```

### Programmatic

```typescript
import { execute } from 'reqon-dsl';

const source = `
  mission Test {
    source API { auth: bearer, base: "https://api.example.com" }
    store items: memory("items")
    action Fetch {
      get "/items"
      store response -> items { key: .id }
    }
    run Fetch
  }
`;

const result = await execute(source, {
  auth: { API: { type: 'bearer', token: 'your-token' } }
});

console.log(await result.stores.get('items').list());
```

## DSL Reference

### Sources

Sources can be defined with explicit base URLs or by referencing an OpenAPI spec:

```vague
// Traditional: explicit base URL
source Name {
  auth: oauth2 | bearer | basic | api_key,
  base: "https://api.example.com"
}

// OAS-based: load from OpenAPI spec (base URL derived from spec)
source Petstore from "./petstore-openapi.yaml" {
  auth: bearer,
  validateResponses: true  // Optional: validate responses against OAS schema
}
```

#### Egress proxies

A source can route its requests through a proxy, or rotate round-robin across a
pool. Rate limit and circuit breaker state are keyed per proxy, so each egress
IP gets its own budget and one failing proxy opens only its own circuit.

```vague
source API {
  auth: none,
  base: "https://api.example.com",
  proxy: [env("PROXY_A"), env("PROXY_B")]
}
```

Needs the optional peer dependency `undici`. See
[examples/fpl-sharded](./examples/fpl-sharded/) for the full sharded-fetch
pattern.

### Stores

```vague
store name: memory("collection")     // In-memory, lost on exit
store name: file("collection")       // JSON files under .reqon-data/
store name: postgrest("table_name")  // PostgreSQL via PostgREST or Supabase
```

`sql()` and `nosql()` parse, but there is no standalone database adapter behind
them. `sql()` works only if you wire up a PostgREST backend for it; `nosql()` has
no implementation at all. Both hard-error unless you opt into the local JSON
fallback with `--dev`. For production storage, use `postgrest`.

### Actions

```vague
action Name {
  // Steps: get/post/put/patch/delete, call, for, map, validate, store
}
```

### HTTP Requests

Two styles are supported:

```vague
// Traditional: explicit HTTP method and path
get "/path" {
  paginate: offset(page, 100),
  until: response.items.length == 0,
  retry: { maxAttempts: 3, backoff: exponential }
}

// OAS-based: reference by Source.operationId
call Petstore.listPets {
  paginate: cursor(cursor, 20, "nextCursor"),
  until: response.pets.length == 0
}
```

When using OAS-based `call`, the HTTP method and path are resolved from the OpenAPI spec automatically.

### Iteration

```vague
for item in collection where .status == "pending" {
  // nested steps
}
```

Loops are sequential by default. `concurrency N` bounds how many iterations run
at once, which is what lets one worker saturate a proxy pool or a generous rate
limit:

```vague
for id in ids concurrency 8 {
  get "/entry/{id.id}"
  store response -> entries { key: .id, upsert: true }
}
```

Iterations get their own scope, so `response` and the loop variable stay
isolated. Stores are shared, so concurrent writes to the same key are
last-writer-wins.

### Mapping

```vague
map source -> TargetSchema {
  field: .sourceField,
  computed: .price * .quantity,
  status: match .state {
    "A" => "active",
    _ => "unknown"
  }
}
```

### Validation

```vague
validate target {
  assume .amount > 0,
  assume .date >= .createdAt
}
```

### Pipeline

```vague
// Sequential execution
run Step1 then Step2 then Step3

// Parallel execution with brackets
run [Step1, Step2] then Step3  // Step1 and Step2 run in parallel, then Step3
```

### Durability Features

```vague
mission DurablePipeline {
  // Checkpoint after each step for resume-on-failure
  checkpoint: afterStep  // or onFailure

  // Enable time-travel debugging
  trace: full  // or minimal

  action WaitForApproval {
    // Resource-free pause (days/weeks without holding resources)
    pause {
      duration: "7d",
      resumeOn: timeout | webhook "/approved"
    }
  }

  run WaitForApproval
}
```

A pause records its deadline and resume triggers, then stops the run. To let the
triggers fire on their own, run under `executeWithResume(source, { executionLog,
webhookServer })`: it stays live, routes an inbound webhook on the pause's path
into the run, polls deadlines, and re-executes past the pause until the mission
finishes. Custom hosts can wire the same behaviour with `PauseOrchestrator`. A
plain CLI run exits on pause instead — resume it with
`reqon mission.vague --resume <executionId>` (or
`execute(source, { executionLog, resumeFrom })`).

#### Durability guarantees

Run a mission as a **durable execution** (`executionLog:`) and an append-only
event log lets an interrupted run — crash, deploy, `kill -9` — resume exactly
where it left off:

- **Delivery**: at-least-once (a step is never silently dropped).
- **Effects**: exactly-once where the API honours idempotency keys (mutating
  fetches carry a stable `Idempotency-Key`), otherwise at-least-once + keyed
  store dedup. Exactly-once on replay via recorded effect identity.
- **Resume across restart**: replay + fold; effects already applied are skipped.
- **Backends**: in-memory (tests), file (dev), `SqliteExecutionLog`
  (transactional, fsync-backed) for single-process self-hosting, and
  `PostgresExecutionLog` for multi-node.

These guarantees are proven by a crash-injection suite that kills the run at
every event boundary and asserts no lost record and no duplicated effect
(`npm run test:crash`). See **[DURABILITY.md](./DURABILITY.md)** for the full
statement and the guarantee → test map.

## OpenAPI Integration

Reqon can consume OpenAPI specs directly, eliminating the need for handwritten SDK code:

```vague
mission SyncPets {
  // Load API definition from OpenAPI spec
  source Petstore from "./petstore.yaml" {
    auth: bearer,
    validateResponses: true
  }

  store pets: memory("pets")

  action FetchPets {
    // Use operationId from spec - method and path are resolved automatically
    call Petstore.listPets

    store response.pets -> pets { key: .id }
  }

  run FetchPets
}
```

Benefits:
- **No SDK required** - The OpenAPI spec *is* the SDK
- **Always up-to-date** - Spec changes are picked up automatically
- **Response validation** - Validate API responses against the spec's schemas
- **Auto-discovery** - Base URLs, paths, and methods come from the spec

## Development

```bash
npm run build          # Compile TypeScript
npm run test:run       # Run tests
npm run dev            # Watch mode
npm run check:snippets # Check every DSL snippet in the docs and examples parses
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full script list, the CI gates,
and the release process.

## License

ISC
