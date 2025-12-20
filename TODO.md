# TODO

## Core Features

- [x] **State persistence** - Durable execution state for resumable missions with checkpointing
- [ ] **Incremental sync** - `since` parameter handling for "only fetch changed since last run"
- [ ] **Idempotency** - Upsert semantics and conflict resolution strategies
- [ ] **Error handling modes** - Stop, skip, retry, or queue failed records

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

- [ ] **`is` type checking** - `assume .items is array` syntax
- [ ] **Parallel execution** - `run Step1, Step2 then Step3` (parallel first two)
- [ ] **Conditional actions** - `run Step1 then Step2 if condition`
- [ ] **Variables/let bindings** - Reusable values within missions
- [ ] **Schema definitions** - Full Vague schema support with validation

## Developer Experience

- [ ] **Better error messages** - Line numbers and context in parse/runtime errors
- [ ] **VS Code extension** - Syntax highlighting and LSP for `.reqon` files
- [ ] **Debug mode** - Step-through execution with state inspection
- [ ] **Dry run improvements** - Mock responses based on schema

## Testing

- [ ] **Integration tests with real APIs** - Xero sandbox, etc.
- [ ] **Property-based testing** - Fuzzing the parser
- [ ] **Benchmark suite** - Performance testing for large datasets

## Documentation

- [ ] **More examples** - QuickBooks, Stripe, Shopify integrations
- [ ] **Architecture docs** - How Reqon extends Vague
- [ ] **Contributing guide**
