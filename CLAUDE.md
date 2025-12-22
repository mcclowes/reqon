# Reqon

A declarative DSL framework for fetch, map, validate pipelines - built on [Vague](https://github.com/mcclowes/vague).

File extension: `.vague`

## Architecture

- **Vague** is the DSL layer (lexer, parser, expression syntax)
- **Reqon** is the runtime/framework extending Vague with execution semantics

## Project Structure

```
src/
├── ast/           # Extended AST nodes (missions, actions, steps)
├── auth/          # Rate limiting, circuit breaker, and auth providers (bearer, oauth2, basic, api_key)
├── benchmark/     # Performance benchmarks (lexer, parser, evaluator, store, e2e)
├── errors/        # Structured error classes (ParseError, RuntimeError, etc.)
├── execution/     # Execution state management and persistence
├── interpreter/   # Runtime execution
│   ├── context.ts       # Execution context (stores, variables)
│   ├── evaluator.ts     # Expression evaluation
│   ├── executor.ts      # Mission/action execution
│   ├── fetch-handler.ts # HTTP fetch with sync checkpoints
│   ├── pagination.ts    # Pagination strategies (offset, page, cursor)
│   ├── http.ts          # HTTP client with retry/backoff
│   └── step-handlers/   # Individual step type handlers (for, map, validate, store, match, webhook)
├── lexer/         # Reqon keywords (uses Vague's lexer via plugin)
├── loader/        # Mission loader (single file or folder with action files)
├── oas/           # OpenAPI spec integration
├── parser/        # Parser for mission/action/fetch/store syntax
├── scheduler/     # Cron/interval scheduling for missions
├── stores/        # Store adapters (memory, file, postgrest; sql/nosql stub to file)
├── sync/          # Incremental sync checkpointing
├── utils/         # Shared utilities (sleep, path traversal, logger, file)
├── webhook/       # Webhook server for async callbacks (wait step)
├── ai-review/     # AI-powered Vague documentation review
├── index.ts       # Main exports
└── cli.ts         # CLI entry point
```

## Commands

```bash
npm run build      # Compile TypeScript
npm run test       # Run tests in watch mode
npm run test:run   # Run tests once
npm run dev        # Watch mode compilation
npm run ai-review  # Run AI documentation review (requires ANTHROPIC_API_KEY)
```

## DSL Syntax

Key constructs:
- `mission` - Pipeline definition
- `source` - API source with auth (oauth2, bearer, basic, api_key, none), or from OAS spec
- `store` - Storage target (memory, file, sql, nosql, postgrest)
- `action` - Discrete pipeline step
- `fetch` - HTTP request (get/post/put/patch/delete) with optional pagination/retry
- `call Source.operationId` - OAS-based fetch using operationId
- `for...in...where` - Iteration with filtering
- `map...->` - Schema transformation
- `validate` - Constraint checking with `assume`
- `run...then` - Pipeline sequencing (supports `run [A, B] then C` for parallel)
- `match` - Pattern matching (from Vague)
- `since: lastSync` - Incremental sync with checkpointing
- `wait` - Webhook/callback waiting with timeout, path, eventFilter, storage
- `schedule` - Mission scheduling (every N units, cron, or at datetime)

## Code Conventions

- TypeScript with strict mode
- Vitest for testing
- Test files alongside implementation (`*.test.ts`)
- Vague dependency via local file link (`file:../vague`)

## Key Decisions

1. **Extends Vague**: Reqon uses Vague's lexer (via plugin system) and expression syntax; parser extends Vague's token types
2. **Keyword conflicts**: Parser explicitly handles Reqon keywords (key, partial, upsert, page, etc.) when they appear in option contexts
3. **`response` identifier**: Special-cased in evaluator to reference `ctx.response`
4. **Store adapters**: Interface-based design for pluggable storage backends
