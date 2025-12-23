# TODO

## Core Features

- [x] **State persistence** - Durable execution state for resumable missions with checkpointing
- [x] **Incremental sync** - `since: lastSync` parameter for "only fetch changed since last run"
- [ ] **Idempotency** - Upsert semantics and conflict resolution strategies
- [x] **Schema overloading** - `match response { Schema1 -> ..., Schema2 -> ... }` - auto-fork based on response shape matching
- [x] **Error handling via match** - Flow control directives (continue, skip, abort, retry, queue, jump) in match arms
- [x] **Multi-file missions** - Split actions into separate files within a folder (mission.vague + action files)
- [x] **Vague plugin system** - Extended Vague with runtime-extensible keywords and statement parsers; Reqon exports a plugin for Vague integration

## Store Adapters

- [x] **File adapter** - JSON file-based storage in `.reqon-data/` for local development
- [ ] **SQL adapter** - PostgreSQL/MySQL store implementation
- [ ] **NoSQL adapter** - MongoDB/DynamoDB store implementation

## API Integration

- [x] **OpenAPI integration** - Load sources from OAS, resolve operationIds, validate responses
- [x] **Rate limiting** - Adaptive rate limiter, parses X-RateLimit-* headers, respects Retry-After, supports pause/throttle/fail strategies with callbacks
- [x] **OAuth2 flow** - Token store interface, auto-refresh before expiry, 401 retry with refresh
- [ ] **Connection registry** - Multi-tenant token management with proactive refresh

## DSL Enhancements

- [x] **`is` type checking** - `assume .items is array` syntax
- [x] **Parallel execution** - `run [Step1, Step2] then Step3` (bracket syntax for parallel stages)
- [x] **Conditional actions** - `run Step1 then Step2 if condition` (already implemented in parser)
- [x] **Variables/let bindings** - Reusable values within missions
- [x] **Schema definitions** - Full Vague schema support with validation and matching

## Developer Experience

- [x] **Better error messages** - Line numbers, column, source context with pointer in parse/lexer/runtime errors
- [ ] **VS Code extension** - Syntax highlighting and LSP for `.vague` files
- [x] **Debug mode** - Step-through execution with state inspection (`--debug` flag, step/step-into/step-over/continue)
- [ ] **Dry run improvements** - Mock responses based on schema

## Testing

- [ ] **Integration tests with real APIs** - Xero sandbox, etc.
- [ ] **Property-based testing** - Fuzzing the parser
- [ ] **Benchmark suite** - Performance testing for large datasets

## Documentation

- [ ] **More examples** - QuickBooks, Stripe, Shopify integrations
- [ ] **Architecture docs** - How Reqon extends Vague
- [ ] **Contributing guide**
