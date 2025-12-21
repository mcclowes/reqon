---
sidebar_position: 9
---

# Variables and Let Bindings

Reqon supports variable bindings using `let` statements and object composition with the spread operator.

## Let Bindings

Create named variables to store intermediate values:

```vague
action ProcessOrder {
  get "/orders/123"

  // Bind response fields to variables
  let orderId = response.id
  let customer = response.customer
  let total = response.items | sum(.price)

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

### Expression Bindings

Variables can hold any expression result:

```vague
let count = length(items)
let filtered = items | filter(.active == true)
let transformed = items | map({ id: .id, name: .name })
let calculated = price * quantity * (1 - discount)
```

### Scope

Variables are scoped to the action in which they're defined:

```vague
action FetchData {
  get "/users"
  let users = response

  for user in users {
    let userId = user.id  // Scoped to this iteration

    get concat("/users/", userId, "/orders")
    store response -> orders { key: .id }
  }
}
```

## Spread Operator

Use the spread operator (`...`) to compose objects:

### Merging Objects

```vague
map response -> EnrichedOrder {
  ...response,              // Include all original fields
  processedAt: now(),       // Add new field
  status: "processed"       // Add/override field
}
```

### Combining Data

```vague
action EnrichCustomer {
  get "/customers/123"
  let customer = response

  get concat("/customers/", customer.id, "/profile")
  let profile = response

  // Merge customer with profile data
  store {
    ...customer,
    ...profile,
    enrichedAt: now()
  } -> enrichedCustomers { key: .id }
}
```

### Selective Spreading

Spread specific nested objects:

```vague
map order -> FlatOrder {
  id: .id,
  ...order.metadata,        // Spread metadata fields
  ...order.shipping,        // Spread shipping fields
  total: .total
}
```

## Common Patterns

### Extracting and Reusing Values

```vague
action SyncWithPagination {
  get "/items" {
    paginate: cursor(cursor, 100, "meta.nextCursor"),
    until: response.meta.nextCursor == null
  }

  // Store pagination metadata
  let meta = response.meta
  let items = response.data

  for item in items {
    store item -> items { key: .id }
  }

  // Log sync stats
  let syncStats = {
    total: meta.total,
    fetched: length(items),
    syncedAt: now()
  }
}
```

### Building Request Bodies

```vague
action CreateOrder {
  let baseOrder = {
    currency: "USD",
    createdAt: now(),
    status: "pending"
  }

  for item in cart.items {
    let orderItem = {
      ...baseOrder,
      ...item,
      orderId: generateId()
    }

    post "/orders" {
      body: orderItem
    }
  }
}
```

### Conditional Field Addition

```vague
action ProcessRecord {
  let base = {
    id: record.id,
    name: record.name
  }

  // Add optional fields conditionally
  let withEmail = if record.email != null
    then { ...base, email: record.email }
    else base

  let final = if record.phone != null
    then { ...withEmail, phone: record.phone }
    else withEmail

  store final -> records { key: .id }
}
```

### Transforming Collections

```vague
action TransformItems {
  get "/items"

  let enriched = response.items | map({
    ...item,
    slug: slugify(.name),
    tags: .categories | map(.name)
  })

  for item in enriched {
    store item -> items { key: .id }
  }
}
```

## Variable Naming

Use descriptive names that indicate the variable's purpose:

```vague
// Good
let activeUsers = users | filter(.status == "active")
let totalRevenue = orders | sum(.amount)
let customerEmail = response.customer.email

// Avoid
let x = users | filter(.status == "active")
let val = orders | sum(.amount)
let e = response.customer.email
```

## Notes

- Variables are immutable once bound
- Variables are evaluated lazily when used
- The `response` variable is automatically set after each fetch
- Spread operator creates a shallow copy of object fields
