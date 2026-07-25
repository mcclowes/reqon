---
sidebar_position: 9
---

# Variables and let bindings

Reqon supports named variable bindings with `let` statements.

## Let bindings

Create named variables to hold intermediate values:

```vague
action ProcessOrder {
  get "/orders/123"

  // Bind response fields to variables
  let orderId = response.id
  let customer = response.customer
  let total = response.total

  // Use variables in subsequent steps
  post "/receipts" {
    body: {
      orderId: orderId,
      customer: customer.email,
      amount: total
    }
  }
}
```

### Expression bindings

A binding can hold any expression result:

```vague
let count = length(items)
let calculated = price * quantity * (1 - discount)
let label = .status == "active" ? "On" : "Off"
let name = .firstName + " " + .lastName
```

There's no pipe operator (`|`) and no `map`/`filter`/`reduce` functions. The `|` symbol is a Vague superposition, not a pipe-forward, so don't use it to chain transformations. Build values from operators and the built-in functions (`length`, `sum`, `count`, `first`, `last`, `round`, `floor`, `ceil`, `now`, `env`).

### Scope

Variables are scoped to the action in which they're defined:

```vague
action FetchData {
  get "/users"
  let users = response

  for user in users {
    let userId = user.id  // Available within this iteration

    get "/users/{userId}/orders"
    store response -> orders { key: .id }
  }
}
```

## Building objects

Object literals build new values field by field. There's no spread operator (`...`), so list the fields you want:

```vague
map response -> EnrichedOrder {
  id: response.id,
  total: response.total,
  processedAt: now(),
  status: "processed"
}
```

The same applies to a `store` step's inline object:

```vague
action EnrichCustomer {
  get "/customers/123"
  let customer = response

  store {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    enrichedAt: now()
  } -> enrichedCustomers { key: .id }
}
```

## Common patterns

### Extracting and reusing values

```vague
action SyncWithPagination {
  get "/items" {
    paginate: cursor(cursor, 100, "meta.nextCursor"),
    until: response.meta.nextCursor == null
  }

  // Capture metadata and data
  let meta = response.meta
  let items = response.data

  for item in items {
    store item -> processed { key: .id }
  }
}
```

### Building request bodies

```vague
action CreateOrder {
  let order = {
    currency: "USD",
    createdAt: now(),
    status: "pending"
  }

  post "/orders" {
    body: order
  }
}
```

### Conditional values

Use the ternary operator to pick a value:

```vague
action ProcessRecord {
  let email = record.email != null ? record.email : "unknown"
  let tier = record.spend > 1000 ? "gold" : "standard"

  store {
    id: record.id,
    name: record.name,
    email: email,
    tier: tier
  } -> records { key: .id }
}
```

## Variable naming

Use descriptive names that say what the variable holds:

```vague
// Good
let customerEmail = response.customer.email
let totalItems = length(response.items)

// Avoid
let e = response.customer.email
let n = length(response.items)
```

## Notes

- Variables are scoped to their action and loop iteration.
- The `response` variable is set automatically after each fetch.
- There's no spread operator and no higher-order array functions; shape data with explicit object literals and the built-in functions.
