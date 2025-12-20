# Petstore Example

Demonstrates OpenAPI spec integration with Reqon.

## What it does

1. Loads API definition from `openapi.yaml`
2. Fetches pets using `operationId` references
3. Normalizes pet data with pattern matching
4. Validates output schema

## Run

```bash
node dist/cli.js examples/petstore/sync.reqon --auth credentials.json --verbose
```

Requires a `credentials.json`:
```json
{
  "Petstore": {
    "type": "bearer",
    "token": "your-api-token"
  }
}
```

## Features demonstrated

- `source ... from "spec.yaml"` for OAS integration
- `validateResponses: true` for response validation against spec
- `fetch Source.operationId` syntax
- Cursor-based pagination
- `match` expressions for value mapping
- `validate` with `assume` constraints
