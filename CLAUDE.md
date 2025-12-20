# Reqon

A declarative DSL framework for fetch, map, validate pipelines - built on [Vague](https://github.com/mcclowes/vague).

## Architecture

- **Vague** is the DSL layer (lexer, parser, expression syntax)
- **Reqon** is the runtime/framework extending Vague with execution semantics

## Project Structure

```
src/
├── ast/           # Extended AST nodes (missions, actions, steps)
├── lexer/         # Extended lexer with Reqon keywords
├── parser/        # Parser for mission/action/fetch/store syntax
├── interpreter/   # Runtime execution
│   ├── context.ts   # Execution context (stores, variables)
│   ├── evaluator.ts # Expression evaluation
│   ├── executor.ts  # Mission/action execution
│   └── http.ts      # HTTP client with retry/backoff
├── stores/        # Store adapters (memory, extensible to SQL/NoSQL)
├── index.ts       # Main exports
└── cli.ts         # CLI entry point
```

## Commands

```bash
npm run build      # Compile TypeScript
npm run test       # Run tests in watch mode
npm run test:run   # Run tests once
npm run dev        # Watch mode compilation
```

## DSL Syntax

Key constructs:
- `mission` - Pipeline definition
- `source` - API source with auth (oauth2, bearer, basic, api_key)
- `store` - Storage target (memory, sql, nosql)
- `action` - Discrete pipeline step
- `fetch` - HTTP request with optional pagination/retry
- `for...in...where` - Iteration with filtering
- `map...->` - Schema transformation
- `validate` - Constraint checking with `assume`
- `run...then` - Pipeline sequencing
- `match` - Pattern matching (from Vague)

## Code Conventions

- TypeScript with strict mode
- Vitest for testing
- Test files alongside implementation (`*.test.ts`)
- Vague dependency via local file link (`file:../vague`)

## Key Decisions

1. **Extends Vague**: Reqon tokens/parser extend Vague's, reusing expression syntax
2. **Keyword conflicts**: Parser explicitly handles Reqon keywords (key, partial, upsert, page, etc.) when they appear in option contexts
3. **`response` identifier**: Special-cased in evaluator to reference `ctx.response`
4. **Store adapters**: Interface-based design for pluggable storage backends
