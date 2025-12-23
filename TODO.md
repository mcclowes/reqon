# TODO

## Core Features

- [ ] **Idempotency** - Upsert semantics and conflict resolution strategies

## Store Adapters

- [ ] **SQL adapter** - PostgreSQL/MySQL store implementation
- [ ] **NoSQL adapter** - MongoDB/DynamoDB store implementation

## API Integration

- [ ] **Connection registry** - Multi-tenant token management with proactive refresh

## Developer Experience

- [ ] **VS Code LSP** - Language server for go-to-definition, autocomplete, diagnostics

## Testing

- [ ] **Integration tests with real APIs** - Xero sandbox, etc.
- [ ] **Property-based testing** - Fuzzing the parser
- [ ] **Benchmark suite** - Performance testing for large datasets

## Documentation

- [ ] **More examples** - QuickBooks, Stripe, Shopify integrations
- [ ] **Architecture docs** - How Reqon extends Vague
- [ ] **Contributing guide**

---

## Completed

- [x] VS Code extension with Reqon keyword injection (vscode-reqon)
- [x] Docs site styling with brand colors (#F3EAD3, #252221)
- [x] Logo integration (logo-light/logo-dark) and favicon
- [x] Sentence case for UI text
- [x] **State persistence** - Durable execution state for resumable missions with checkpointing
- [x] **Incremental sync** - `since: lastSync` parameter for "only fetch changed since last run"
- [x] **Schema overloading** - `match response { Schema1 -> ..., Schema2 -> ... }`
- [x] **Error handling via match** - Flow control directives (continue, skip, abort, retry, queue, jump)
- [x] **Multi-file missions** - Split actions into separate files within a folder
- [x] **Vague plugin system** - Runtime-extensible keywords and statement parsers
- [x] **File adapter** - JSON file-based storage in `.reqon-data/`
- [x] **OpenAPI integration** - Load sources from OAS, resolve operationIds, validate responses
- [x] **Rate limiting** - Adaptive rate limiter with X-RateLimit-* header parsing
- [x] **OAuth2 flow** - Token store interface, auto-refresh, 401 retry
- [x] **`is` type checking** - `assume .items is array` syntax
- [x] **Parallel execution** - `run [Step1, Step2] then Step3`
- [x] **Conditional actions** - `run Step1 then Step2 if condition`
- [x] **Variables/let bindings** - Reusable values within missions
- [x] **Schema definitions** - Full Vague schema support with validation and matching
- [x] **Better error messages** - Line numbers, column, source context with pointer
- [x] **Debug mode** - Step-through execution with `--debug` flag
- [x] **Dry run mock data** - Mock responses generated from OAS schemas
