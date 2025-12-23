# Mock Server Demo

Demonstrates Reqon's mock data generation from OpenAPI schemas. When running with `--dry-run`, Reqon generates realistic mock data based on the OpenAPI response schemas.

## Files

- `openapi.yaml` - E-commerce API spec with products, orders, and inventory endpoints
- `sync.vague` - Mission that fetches and processes data from the API
- `output.json` - Generated output containing mock data

## Running

From this directory:

```bash
node ../../dist/cli.js sync.vague --dry-run --verbose
```

Or from the project root:

```bash
node dist/cli.js examples/mock-server-demo/sync.vague --dry-run --verbose
```

## What It Demonstrates

1. **OAS Integration**: Load an API source from an OpenAPI spec
2. **Mock Data Generation**: In dry-run mode, mock data is generated from schema definitions
3. **Parallel Execution**: Multiple fetch actions run concurrently
4. **Data Transformation**: Map and normalize data between schemas
5. **Store Operations**: Upsert data with key-based deduplication

## Mock Data Features

The mock generator produces realistic data based on OpenAPI schema properties:

- `format: uuid` generates valid UUIDs
- `format: date-time` generates ISO timestamps
- `example` values are used when provided
- `enum` picks the first valid value
- `minimum`/`maximum` constraints are respected
- Arrays are populated with sample items

## Output

After running, `output.json` contains the processed mock data:

```json
{
  "products": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Wireless Bluetooth Headphones",
      "price": 149.99,
      "category": "electronics",
      "inStock": true,
      "stockQuantity": 42
    }
  ],
  "orders": [...],
  "inventory": [...],
  "order_summary": [...]
}
```
