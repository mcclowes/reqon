# Reqon

A declarative DSL framework for fetch, map, validate pipelines - built on [Vague](https://github.com/mcclowes/vague).

## Architecture

- **Vague** is the DSL layer (lexer, parser, expression syntax)
- **Reqon** is the runtime/framework extending Vague with execution semantics

```
┌─────────────────────────────────────────────────────────┐
│  Reqon DSL (.reqon/.vague files)                        │
├─────────────────────────────────────────────────────────┤
│  Parser (extends Vague)  →  AST (missions, actions)     │
├─────────────────────────────────────────────────────────┤
│  Executor  →  Step Handlers  →  Stores/HTTP Client      │
├─────────────────────────────────────────────────────────┤
│  Observability (events, logging, OpenTelemetry)         │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── ast/               # Extended AST nodes (missions, actions, steps)
│   └── nodes.ts       # All node type definitions
├── auth/              # Authentication and resilience
│   ├── credentials.ts # Env var interpolation, credential loading
│   ├── rate-limiter.ts # Adaptive rate limiting with pause/throttle/fail
│   ├── circuit-breaker.ts # Circuit breaker pattern implementation
│   ├── oauth2-provider.ts # OAuth2 token refresh
│   └── token-store.ts # Token persistence
├── benchmark/         # Performance benchmarks
│   ├── index.ts       # Benchmark runner CLI
│   └── *.bench.ts     # Suite-specific benchmarks
├── errors/            # Structured error classes
│   └── index.ts       # ParseError, RuntimeError, ValidationError, etc.
├── execution/         # Execution state management and persistence
│   ├── state.ts       # ExecutionState, stage tracking, resume logic
│   └── store.ts       # FileExecutionStore, MemoryExecutionStore
├── interpreter/       # Runtime execution
│   ├── context.ts     # ExecutionContext (stores, variables, sources)
│   ├── evaluator.ts   # Expression evaluation (extends Vague)
│   ├── executor.ts    # MissionExecutor - orchestrates pipeline
│   ├── fetch-handler.ts # HTTP fetch with sync checkpoints
│   ├── pagination.ts  # Pagination strategies (offset, page, cursor)
│   ├── http.ts        # HttpClient with auth, rate limiting, retries
│   ├── schema-matcher.ts # Schema matching for match steps
│   └── step-handlers/ # Individual step implementations
│       ├── for-handler.ts
│       ├── map-handler.ts
│       ├── match-handler.ts
│       ├── store-handler.ts
│       ├── validate-handler.ts
│       ├── apply-handler.ts
│       └── webhook-handler.ts
├── lexer/             # Reqon keywords (uses Vague's lexer via plugin)
├── loader/            # Mission file/folder loading
│   └── index.ts       # loadMission, isMissionFolder
├── mcp/               # Model Context Protocol server
│   ├── server.ts      # MCP server implementation
│   └── index.ts       # Version export
├── oas/               # OpenAPI spec integration
│   ├── loader.ts      # Load and parse OAS specs
│   └── validator.ts   # Response validation against schemas
├── observability/     # Mission execution monitoring
│   ├── events.ts      # Event emitter and payload types
│   ├── logger.ts      # Structured logging with multiple outputs
│   └── otel.ts        # OpenTelemetry span builder and OTLP export
├── parser/            # Parser for mission/action/fetch/store syntax
│   ├── base.ts        # Core parser extending Vague
│   └── expressions.ts # Reqon-specific expression parsing
├── scheduler/         # Cron scheduling for missions
│   ├── scheduler.ts   # Job scheduler with daemon mode
│   └── cron-parser.ts # Cron expression parsing
├── stores/            # Store adapters
│   ├── memory.ts      # In-memory store
│   ├── file.ts        # File-based JSON store
│   ├── postgrest.ts   # PostgREST SQL adapter
│   ├── factory.ts     # createStore factory function
│   └── types.ts       # StoreAdapter interface
├── sync/              # Incremental sync checkpointing
│   ├── state.ts       # Checkpoint state management
│   └── store.ts       # FileSyncStore, MemorySyncStore
├── utils/             # Shared utilities
│   ├── async.ts       # Async helpers (sleep, retry)
│   ├── path.ts        # JSON path traversal
│   ├── file.ts        # File system helpers
│   └── logger.ts      # Console logger
├── webhook/           # Webhook server for async flows
│   ├── server.ts      # HTTP server for webhook endpoints
│   └── store.ts       # Webhook event storage
├── plugin.ts          # Vague plugin registration
├── index.ts           # Main exports and convenience functions
└── cli.ts             # CLI entry point
```

## Commands

```bash
npm run build           # Compile TypeScript
npm run test            # Run tests in watch mode
npm run test:run        # Run tests once
npm run test:coverage   # Run tests with coverage
npm run dev             # Watch mode compilation

# Benchmarks
npm run bench           # Run all benchmarks
npm run bench:lexer     # Lexer performance
npm run bench:parser    # Parser performance
npm run bench:evaluator # Expression evaluation
npm run bench:store     # Store operations
npm run bench:resilience # Rate limiting, circuit breaker
npm run bench:e2e       # End-to-end pipeline
```

## CLI Usage

```bash
# Single run
reqon sync-invoices.reqon --verbose
reqon ./sync-invoices/ --verbose        # Folder with mission.reqon + action files
reqon sync-invoices.reqon --auth ./credentials.json
reqon sync-invoices.reqon --dry-run     # Validate without HTTP requests

# With webhook server
reqon payment-flow.reqon --webhook --webhook-port 8080

# Daemon mode (scheduled missions)
reqon sync-invoices.reqon --daemon --verbose
reqon sync-invoices.reqon --once        # Run scheduled missions once, then exit

# Environment and credentials
reqon sync.reqon --env .env.production --auth ./credentials.json
```

## DSL Syntax

### Mission Structure

```vague
mission SyncXeroInvoices {
  schedule: every 6 hours           # Optional scheduling

  source Xero {
    auth: oauth2,
    base: "https://api.xero.com/api.xro/2.0",
    rateLimit: { strategy: pause, maxWait: 300 },
    circuitBreaker: { failureThreshold: 5, resetTimeout: 30 }
  }

  store invoices: memory("invoices")
  store normalized: sql("normalized_invoices")

  schema StandardInvoice { id: string, amount: decimal, status: string }

  transform ToStandard: RawInvoice -> StandardInvoice {
    id: .InvoiceID,
    amount: .Total,
    status: .Status
  }

  action FetchInvoices { ... }
  action NormalizeInvoices { ... }

  run FetchInvoices then NormalizeInvoices
  run [FetchA, FetchB] then Merge       # Parallel execution
}
```

### Key Constructs

| Construct | Description | Example |
|-----------|-------------|---------|
| `mission` | Pipeline definition | `mission SyncData { ... }` |
| `source` | API source with auth | `source API { auth: bearer, base: "..." }` |
| `source from` | OAS-based source | `source API from "./openapi.yaml" { auth: bearer }` |
| `store` | Storage target | `store data: memory("cache")` |
| `schema` | Data schema definition | `schema Item { id: string, name: string }` |
| `transform` | Reusable mapping | `transform ToX: A -> B { ... }` |
| `action` | Discrete pipeline step | `action FetchItems { ... }` |
| `schedule` | Cron/interval scheduling | `schedule: cron "0 */6 * * *"` |

### Action Steps

| Step | Description | Example |
|------|-------------|---------|
| `get/post/...` | HTTP request | `get "/items" { paginate: offset(page, 100) }` |
| `call` | OAS operationId | `call API.listItems` |
| `for...in...where` | Iteration | `for item in items where .active { ... }` |
| `map...->` | Schema transform | `map item -> StandardItem { id: .itemId }` |
| `apply` | Named transform | `apply ToStandard to item` |
| `validate` | Constraint check | `validate response { assume .amount > 0 }` |
| `store...->` | Persist data | `store response -> cache { key: .id }` |
| `match` | Schema/pattern match | `match response { Schema -> continue, _ -> abort }` |
| `let` | Variable binding | `let total = .price * .quantity` |
| `wait` | Webhook wait | `wait { timeout: 60000, path: "/webhook" }` |

### Fetch Options

```vague
get "/items" {
  paginate: offset(page, 100),       # Pagination strategy
  until: length(response.items) == 0, # Stop condition
  retry: { maxAttempts: 3, backoff: exponential },
  since: lastSync,                    # Incremental sync
  sinceParam: "modified_after",       # Query param for since
  sinceFormat: "iso"                  # Date format
}
```

### Flow Control (in match steps)

```vague
match response {
  SuccessSchema -> continue,
  RateLimitError -> retry { maxAttempts: 5, backoff: exponential },
  AuthError -> jump RefreshToken then retry,
  ValidationError -> queue "dlq",
  NotFound -> skip,
  _ -> abort "Unexpected response"
}
```

### Store Options

```vague
store response -> invoices {
  key: .InvoiceID,      # Primary key
  partial: true,        # Mark as partial (needs hydration)
  upsert: true          # Update if exists
}
```

## MCP Server

Reqon exposes an MCP (Model Context Protocol) server for AI assistant integration:

```bash
# Start MCP server
reqon-mcp --verbose
```

**Available Tools:**
- `reqon.execute` - Execute mission from DSL source
- `reqon.execute_file` - Execute from file/folder path
- `reqon.parse` - Parse DSL and return AST summary
- `reqon.query_store` - Query data from a store
- `reqon.list_stores` - List registered stores
- `reqon.register_store` - Register a store for cross-execution access

**Resources:**
- `reqon://stores` - List all stores
- `reqon://stores/{name}` - Access store data

## Observability

The observability system provides comprehensive mission monitoring:

```typescript
import { createEmitter, createStructuredLogger, createOTelListener } from 'reqon';

// Event emitter for fine-grained events
const emitter = createEmitter();
emitter.on('fetch.start', (payload) => console.log(payload));
emitter.on('stage.complete', (payload) => console.log(payload));

// Structured logger with multiple outputs
const logger = createStructuredLogger({
  prefix: 'MyApp',
  level: 'debug',
  outputs: [new ConsoleOutput(), new JsonLinesOutput(stream)]
});

// OpenTelemetry integration
const otelListener = createOTelListener({ exporter: new OTLPExporter(config) });
emitter.on('*', otelListener);

// Pass to executor
const executor = new MissionExecutor({
  eventEmitter: emitter,
  logger,
});
```

**Event Types:**
- `mission.start`, `mission.complete`, `mission.failed`
- `stage.start`, `stage.complete`
- `step.start`, `step.complete`
- `fetch.start`, `fetch.complete`, `fetch.retry`, `fetch.error`
- `loop.start`, `loop.iteration`, `loop.complete`
- `data.transform`, `data.validate`, `data.store`

## Programmatic Usage

```typescript
import { parse, execute, fromPath, reqon } from 'reqon';

// Parse DSL
const program = parse(`mission Test { ... }`);

// Execute from source
const result = await execute(source, {
  auth: { API: { type: 'bearer', token: 'xxx' } },
  verbose: true,
});

// Execute from file/folder
const result = await fromPath('./sync-invoices/', config);

// Tagged template literal
const program = reqon`
  mission Inline {
    source API { auth: none, base: "https://api.example.com" }
    ...
  }
`;
```

## Code Conventions

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- Vitest for testing
- Test files alongside implementation (`*.test.ts`)
- Node.js >= 18 required
- Vague dependency via local file link (`file:../vague`)

## Testing Patterns

```typescript
// Unit test example
import { describe, it, expect, vi } from 'vitest';
import { ForHandler } from './for-handler.js';

describe('ForHandler', () => {
  it('iterates over collection', async () => {
    const handler = new ForHandler({
      ctx: createContext(),
      log: vi.fn(),
      emit: vi.fn(),
      executeStep: vi.fn(),
      actionName: 'TestAction',
    });

    await handler.execute(forStep);
    expect(deps.executeStep).toHaveBeenCalledTimes(3);
  });
});
```

## Key Decisions

1. **Extends Vague**: Reqon uses Vague's lexer (via plugin system) and expression syntax; parser extends Vague's token types

2. **Keyword conflicts**: Parser explicitly handles Reqon keywords (key, partial, upsert, page, etc.) when they appear in option contexts

3. **`response` identifier**: Special-cased in evaluator to reference `ctx.response`

4. **Store adapters**: Interface-based design for pluggable storage backends. Development mode (default) uses file stores for sql/nosql types

5. **Step handlers**: Each action step type has a dedicated handler class in `interpreter/step-handlers/`

6. **Flow control signals**: Match step flow directives use exception-based signals (SkipSignal, RetrySignal, JumpSignal, etc.)

7. **Observability decoupled**: Event emission is optional and doesn't affect execution logic

8. **Multi-file missions**: Folders with `mission.reqon` + action files are loaded and merged

## Examples

See `examples/` directory for comprehensive examples:

| Example | Key Features |
|---------|--------------|
| `jsonplaceholder/` | Basic public API, fetch, map, for loops |
| `petstore/` | OpenAPI spec integration, cursor pagination |
| `xero/` | OAuth2, match steps, flow control |
| `github-sync/` | Multi-file mission, parallel execution |
| `error-handling/` | All flow control directives |
| `temporal-comparison/` | Multi-source, rate limiting, reconciliation |
| `incremental-sync/` | `since: lastSync`, checkpointing |
| `webhook-payment/` | `wait` steps, webhook filtering |
| `scheduled-reports/` | Cron scheduling, alerting |
| `circuit-breaker/` | Circuit breaker, fallback sources |
| `database-sync/` | SQL/NoSQL stores, upsert |
| `data-enrichment/` | `let` bindings, spread operator |

## Credentials

Credentials support environment variable interpolation:

```json
{
  "SourceName": {
    "type": "bearer",
    "token": "${API_TOKEN}"
  },
  "OAuthSource": {
    "type": "oauth2",
    "accessToken": "${ACCESS_TOKEN}",
    "refreshToken": "${REFRESH_TOKEN:-}"
  }
}
```

Auto-discovery from environment:
- `REQON_{SOURCE}_TOKEN` - Bearer token
- `REQON_{SOURCE}_TYPE` - Auth type
- `REQON_{SOURCE}_API_KEY` - API key
