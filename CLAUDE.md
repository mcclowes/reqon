# Reqon

A declarative DSL framework for fetch, map, validate pipelines - built on [Vague](https://github.com/mcclowes/vague).

Published to npm as `reqon-dsl`; the CLI binaries are `reqon` and `reqon-mcp`. Requires Node.js >= 22.

File extensions: `.vague` and `.reqon` (both supported; the loader tries `.vague` then `.reqon`)

## Architecture

- **Vague** is the DSL layer (lexer, parser, expression syntax)
- **Reqon** is the runtime/framework extending Vague with execution semantics

## Project Structure

```
src/
├── ast/           # Extended AST nodes (missions, actions, steps)
├── auth/          # Rate limiting (incl. a self-calibrating model for headerless limiters),
│                  # circuit breaker, credential loading, token store, and auth providers
├── benchmark/     # Performance benchmarks (lexer, parser, evaluator, store, e2e)
├── config/        # Runtime configuration and constants
├── control/       # Control server for pause/resume, status queries, heartbeats
├── debug/         # CLI debugger and debug controller
├── durability/    # Crash-injection tests for durable execution
├── errors/        # Structured error classes (ParseError, RuntimeError, etc.)
├── execution/     # Execution state management and persistence
├── execution-log/ # Append-only event log (file/sqlite/postgres stores); pause/sync/trace are views over it
├── interpreter/   # Runtime execution
│   ├── context.ts       # Execution context (stores, variables)
│   ├── evaluator.ts     # Expression evaluation
│   ├── executor.ts      # Mission/action execution
│   ├── fetch-handler.ts # HTTP fetch with sync checkpoints
│   ├── pagination.ts    # Pagination strategies (offset, page, cursor)
│   ├── proxy.ts         # Egress proxy pool (round-robin, cached undici dispatchers)
│   ├── http.ts          # HTTP client with retry/backoff
│   ├── schema-matcher.ts # Schema matching logic
│   ├── signals.ts       # Execution signals (abort, skip, pause, etc.)
│   ├── source-manager.ts # Source resolution and lifecycle
│   ├── store-manager.ts  # Store resolution and lifecycle
│   └── step-handlers/   # Individual step type handlers (for, map, validate, store, match, webhook, apply, pause)
├── lexer/         # Reqon keywords (uses Vague's lexer via plugin)
├── loader/        # Mission loader (single file or folder with action files)
├── mcp/           # Model Context Protocol integration
├── oas/           # OpenAPI spec integration (loader, validator)
├── observability/ # Structured events, logging, OpenTelemetry integration
├── parser/        # Parser for mission/action/fetch/store syntax
├── pause/         # Resource-free long pauses (state, store, manager)
├── scheduler/     # Cron/interval scheduling for missions
├── stores/        # Store adapters (memory, file, postgrest) + a batching wrapper.
│                  # sql/nosql have no real backend: they throw unless --dev opts
│                  # into the local JSON file fallback.
├── sync/          # Incremental sync checkpointing
├── trace/         # Time-travel debugging (recorder, replayer, snapshots)
├── utils/         # Shared utilities (async, path traversal, logger, atomic file
│                  # writes, deep merge, secret redaction, long timeouts)
├── webhook/       # Webhook server for async callbacks (wait step)
├── index.ts       # Main exports
├── plugin.ts      # Vague plugin integration
└── cli.ts         # CLI entry point
```

## Commands

```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode compilation
npm run typecheck  # Type-check without emitting
npm run test       # Run tests in watch mode
npm run test:run   # Run tests once
npm run test:crash # Crash-injection durability suite (src/durability/)
npm run test:pg    # Postgres execution-log tests (needs a Postgres)
npm run lint       # ESLint over src/
npm run format     # Prettier write over src/
npm run bench      # Run performance benchmarks
```

CI gates on `typecheck`, `lint`, `test:run`, `test:crash`, and `test:pg`. The
pre-commit hook runs lint-staged (eslint + prettier) and the full test suite, but
not `typecheck` - vitest strips types without checking them, so run `typecheck`
yourself before pushing.

## DSL Syntax

Key constructs:
- `mission` - Pipeline definition
- `source` - API source with auth (oauth2, bearer, basic, api_key, none), or from OAS spec.
  All four auth types are wired to a provider (`bearer`, `oauth2`, `basic`,
  `api_key`); an auth type configured without its required credentials throws
  rather than sending an unauthenticated request (see
  `SourceManager.createAuthProvider`)
- `proxy: [...]` - Egress proxy pool on a source, rotated per request attempt; rate limit and circuit breaker state are keyed per proxy (needs optional peer dep `undici`)
- `store` - Storage target (memory, file, postgrest; sql/nosql need `--dev` to fall back to files)
- `action` - Discrete pipeline step
- `fetch` - HTTP request (get/post/put/patch/delete) with optional pagination/retry
- `call Source.operationId` - OAS-based fetch using operationId
- `for...in...where` - Iteration with filtering, optional `concurrency N` for bounded fan-out (default sequential)
- `map...->` - Schema transformation
- `validate` - Constraint checking with `assume`
- `run...then` - Pipeline sequencing (supports `run [A, B] then C` for parallel)
- `match` - Pattern matching (from Vague)
- `since: lastSync` - Incremental sync with checkpointing
- `wait` - Webhook/callback waiting with timeout, path, eventFilter, storage
- `schedule` - Mission scheduling (every N units, cron, or at datetime)
- `checkpoint` - Durable execution mode (afterStep, onFailure)
- `trace` - Time-travel debugging mode (full, minimal)
- `pause` - Resource-free long pauses with resume triggers (timeout, webhook). Triggers are
  recorded, not dispatched: nothing calls `PauseManager.startMonitoring()`/`handleWebhook()`
  in the shipped runtime, so a paused run resumes when you re-run with `--resume <execId>`

## Code Conventions

- TypeScript with strict mode
- Vitest for testing
- Test files alongside implementation (`*.test.ts`)
- Vague is a published npm dependency (`vague-lang`), not a local file link
- Optional peer deps, dynamically imported behind a "install this" error:
  `better-sqlite3` (SQLite execution log), `pg` (Postgres execution log),
  `undici` (egress proxy pools)

## Key Decisions

1. **Extends Vague**: Reqon uses Vague's lexer (via plugin system) and expression syntax; parser extends Vague's token types
2. **Keyword conflicts**: Parser explicitly handles Reqon keywords (key, partial, upsert, page, etc.) when they appear in option contexts
3. **`response` identifier**: Special-cased in evaluator to reference `ctx.response`
4. **Store adapters**: Interface-based design for pluggable storage backends
