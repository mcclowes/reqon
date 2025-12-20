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

```reqon
source Name {
  auth: oauth2 | bearer | basic | api_key,
  base: "https://api.example.com"
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

```reqon
fetch GET "/path" {
  paginate: offset(page, 100),
  until: response.items.length == 0,
  retry: { maxAttempts: 3, backoff: exponential }
}
```

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

## Development

```bash
npm run build      # Compile TypeScript
npm run test:run   # Run tests
npm run dev        # Watch mode
```

## License

ISC
