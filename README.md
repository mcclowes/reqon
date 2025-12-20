# Reqon

A declarative DSL for fetch, map, validate pipelines - built on [Vague](https://github.com/mcclowes/vague).

## What is Reqon?

Reqon lets you define data synchronization pipelines in a readable, declarative language. Think of it like Temporal.io, but with a focus on API data fetching and transformation.

## Example

```reqon
mission SyncXeroInvoices {
  source Xero {
    auth: oauth2,
    base: "https://api.xero.com/api.xro/2.0"
  }

  store invoices: memory("invoices")
  store normalized: memory("normalized")

  action FetchInvoices {
    fetch GET "/Invoices" {
      paginate: offset(page, 100),
      until: length(response.Invoices) == 0
    }

    store response.Invoices -> invoices {
      key: .InvoiceID,
      partial: true
    }
  }

  action NormalizeInvoices {
    for invoice in invoices {
      map invoice -> StandardInvoice {
        id: .InvoiceID,
        amount: .Total,
        status: match .Status {
          "PAID" => "paid",
          "AUTHORISED" => "approved",
          _ => "pending"
        }
      }

      validate response {
        assume .amount >= 0
      }

      store response -> normalized { key: .id }
    }
  }

  run FetchInvoices then NormalizeInvoices
}
```

## Installation

```bash
npm install reqon
```

## Usage

### CLI

```bash
reqon sync-invoices.reqon --verbose
reqon sync-invoices.reqon --auth ./credentials.json
reqon sync-invoices.reqon --dry-run
```

### Programmatic

```typescript
import { parse, execute } from 'reqon';

const program = parse(`
  mission Test {
    source API { auth: bearer, base: "https://api.example.com" }
    store items: memory("items")
    action Fetch {
      fetch GET "/items"
      store response -> items { key: .id }
    }
    run Fetch
  }
`);

const result = await execute(source, {
  auth: { API: { type: 'bearer', token: 'your-token' } }
});

console.log(result.stores.get('items').list());
```

## DSL Reference

### Sources

Sources can be defined with explicit base URLs or by referencing an OpenAPI spec:

```reqon
// Traditional: explicit base URL
source Name {
  auth: oauth2 | bearer | basic | api_key,
  base: "https://api.example.com"
}

// OAS-based: load from OpenAPI spec (base URL derived from spec)
source Petstore from "./petstore-openapi.yaml" {
  auth: bearer,
  validateResponses: true  // Optional: validate responses against OAS schema
}
```

### Stores

```reqon
store name: memory("collection")
store name: sql("table_name")
store name: nosql("collection")
```

### Actions

```reqon
action Name {
  // Steps: fetch, for, map, validate, store
}
```

### Fetch

Two styles are supported:

```reqon
// Traditional: explicit HTTP method and path
fetch GET "/path" {
  paginate: offset(page, 100),
  until: response.items.length == 0,
  retry: { maxAttempts: 3, backoff: exponential }
}

// OAS-based: reference by Source.operationId
fetch Petstore.listPets {
  paginate: cursor(cursor, 20, "nextCursor"),
  until: response.pets.length == 0
}
```

When using OAS-based fetch, the HTTP method and path are resolved from the OpenAPI spec automatically.

### Iteration

```reqon
for item in collection where .status == "pending" {
  // nested steps
}
```

### Mapping

```reqon
map source -> TargetSchema {
  field: .sourceField,
  computed: .price * .quantity,
  status: match .state {
    "A" => "active",
    _ => "unknown"
  }
}
```

### Validation

```reqon
validate target {
  assume .amount > 0,
  assume .date >= .createdAt
}
```

### Pipeline

```reqon
run Step1 then Step2 then Step3
```

## OpenAPI Integration

Reqon can consume OpenAPI specs directly, eliminating the need for handwritten SDK code:

```reqon
mission SyncPets {
  // Load API definition from OpenAPI spec
  source Petstore from "./petstore.yaml" {
    auth: bearer,
    validateResponses: true
  }

  store pets: memory("pets")

  action FetchPets {
    // Use operationId from spec - method and path are resolved automatically
    fetch Petstore.listPets

    store response.pets -> pets { key: .id }
  }

  run FetchPets
}
```

Benefits:
- **No SDK required** - The OpenAPI spec *is* the SDK
- **Always up-to-date** - Spec changes are picked up automatically
- **Response validation** - Validate API responses against the spec's schemas
- **Auto-discovery** - Base URLs, paths, and methods come from the spec

## Development

```bash
npm run build      # Compile TypeScript
npm run test:run   # Run tests
npm run dev        # Watch mode
```

## License

ISC
