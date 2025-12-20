# TODO

## Core Features

- [ ] **State persistence** - Durable execution state for resumable missions (like Temporal)
- [ ] **Incremental sync** - `since` parameter handling for "only fetch changed since last run"
- [ ] **Idempotency** - Upsert semantics and conflict resolution strategies
- [ ] **Error handling modes** - Stop, skip, retry, or queue failed records

## Store Adapters

- [ ] **SQL adapter** - PostgreSQL/MySQL store implementation
- [ ] **NoSQL adapter** - MongoDB/DynamoDB store implementation
- [ ] **File adapter** - JSON/CSV file-based storage

## API Integration

- [ ] **OpenAPI import** - Auto-generate fetch configs from OpenAPI specs
- [ ] **Rate limiting** - Respect API rate limits from response headers
- [ ] **OAuth2 flow** - Full token refresh flow with automatic retry

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
