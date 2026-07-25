---
sidebar_position: 4
---

# Validation

Validate steps check data constraints before processing or storing. They help ensure data quality and catch issues early.

A `validate` step needs a target expression. Each `assume` takes a single condition. If any condition is false, the step throws a `ValidationError` and the mission aborts; there are no warning-level assumptions and no custom message syntax.

## Basic syntax

```vague
validate target {
  assume constraint1,
  assume constraint2
}
```

## Simple validation

```vague
action ValidateUsers {
  get "/users"

  for user in response.users {
    validate user {
      assume .id is string,
      assume length(.name) > 0,
      assume .email is string
    }

    store user -> users { key: .id }
  }
}
```

## Constraint types

### Type checking

```vague
validate data {
  assume .id is string,
  assume .count is number,
  assume .active is boolean,
  assume .tags is array,
  assume .metadata is object,
  assume .deletedAt is null
}
```

### Existence checks

```vague
validate data {
  assume .id != null,
  assume .name != null,
  assume .email != null
}
```

### String constraints

There are no string-matching operators or functions like `contains`, `startsWith`, or `endsWith`. You can check presence, type, and length:

```vague
validate user {
  assume .name is string,
  assume length(.name) > 0,
  assume length(.name) < 100,
  assume .email != null
}
```

### Numeric constraints

```vague
validate order {
  assume .quantity > 0,
  assume .price >= 0,
  assume .discount >= 0 and .discount <= 100,
  assume .total == .price * .quantity
}
```

### Array constraints

```vague
validate response {
  assume length(.items) > 0,
  assume length(.items) <= 100
}
```

### Comparison

```vague
validate event {
  assume .endDate >= .startDate,
  assume .createdAt <= now()
}
```

## Complex constraints

### Logical operators

```vague
validate user {
  assume .status == "active" or .status == "pending",
  assume .age >= 18 and .age <= 120,
  assume not (.status == "banned")
}
```

### Conditional validation

```vague
validate order {
  // If discount is present, it must be valid
  assume .discount == null or (.discount >= 0 and .discount <= 50),

  // If status is shipped, must have tracking
  assume .status != "shipped" or .trackingNumber != null
}
```

## Validation behavior

A failed `assume` throws and aborts the mission. There is no warning level, so validation is always strict:

```vague
validate user {
  assume length(.name) > 0  // Aborts the mission if this is false
}
// This line is only reached when every assumption holds
```

If you'd rather route invalid records instead of aborting, skip `validate` and use a `match` step with a guard:

```vague
schema User {
  id: string,
  email: string
}

action RouteUsers {
  get "/users"

  for user in response.users {
    match user {
      User -> store user -> users { key: .id },
      _ -> skip
    }
  }
}
```

## Validating nested data

```vague
validate order {
  assume .id is string,
  assume .customer.id is string,
  assume .customer.email is string,
  assume length(.items) > 0,
  assume .items[0].quantity > 0
}
```

## Validating arrays

```vague
action ValidateAllItems {
  get "/orders"

  for order in response.orders {
    // Validate order-level
    validate order {
      assume .id is string,
      assume .total > 0
    }

    // Validate each item
    for item in order.items {
      validate item {
        assume .productId is string,
        assume .quantity > 0,
        assume .price >= 0
      }
    }
  }
}
```

## Routing invalid records

When you don't want a failure to abort the mission, route records with `match` and a guarded wildcard instead of `validate`:

```vague
action RouteInvalid {
  get "/users"

  for user in response.users {
    match user {
      _ where user.email == null -> {
        store { userId: user.id, error: "Missing email" } -> validationErrors { key: user.id }
        skip
      },
      _ where user.age < 18 -> {
        store { userId: user.id, error: "User under 18" } -> validationErrors { key: user.id }
        skip
      },
      _ -> store user -> validUsers { key: .id }
    }
  }
}
```

## Validation before store

Validate before storing, so bad records abort early:

```vague
action SafeStore {
  get "/data"

  for item in response.data {
    validate item {
      assume .id is string,
      assume .value is number
    }

    store item -> data { key: .id }
  }
}
```

## Validation schemas

Use schemas for reusable validation:

```vague
schema ValidUser {
  id: string,
  name: string,
  email: string
}

action ValidateAgainstSchema {
  get "/users"

  for user in response.users {
    match user {
      ValidUser -> store user -> users { key: .id },
      _ -> store user -> invalidUsers { key: .id }
    }
  }
}
```

## Built-in functions in constraints

The expression language has a small set of built-in functions. The ones useful in constraints are `length`, `sum`, `count`, `first`, `last`, `round`, `floor`, `ceil`, and `now`:

```vague
validate data {
  // Length and count
  assume length(.name) > 0,
  assume length(.items) > 0,

  // Numeric
  assume round(.price) == .price,
  assume sum(.amounts) > 0,

  // Timestamps (compared as strings or dates)
  assume .createdAt != null
}
```

## Complete example

```vague
mission DataValidation {
  source API { auth: bearer, base: "https://api.example.com" }

  store validOrders: file("valid-orders")
  store invalidOrders: file("invalid-orders")
  store validationErrors: file("validation-errors")

  schema ValidOrder {
    id: string,
    customerId: string,
    items: array,
    total: number
  }

  action ValidateOrders {
    get "/orders"

    for order in response.orders {
      // Type validation
      validate order {
        assume .id is string,
        assume .customerId is string,
        assume .items is array,
        assume .total is number
      }

      // Business rule validation
      validate order {
        assume length(.items) > 0,
        assume .total > 0,
        assume .status == "pending" or .status == "confirmed"
      }

      // Route based on schema match
      match order {
        ValidOrder where order.total > 0 and length(order.items) > 0 -> {
          store order -> validOrders { key: .id }
        },
        _ -> {
          store {
            orderId: order.id,
            order: order,
            reason: "Failed validation"
          } -> invalidOrders { key: order.id }
        }
      }
    }
  }

  run ValidateOrders
}
```

## Best practices

### Validate early

```vague
action Process {
  get "/data"

  // Validate immediately after fetch
  validate response {
    assume .data is array,
    assume length(.data) > 0
  }

  // Then process
  for item in response.data { }
}
```

### Use specific constraints

```vague
// Good: specific constraints
validate user {
  assume .email is string,
  assume length(.email) > 5,
  assume .age >= 18
}

// Avoid: too loose
validate user {
  assume .email != null
}
```

### Route failures instead of aborting

When you want to record bad records rather than stop, route them with a guarded `match`:

```vague
action RouteWithLogging {
  for item in items {
    match item {
      _ where item.id == null -> {
        store { itemId: "unknown", field: "id", error: "Missing" } -> errors { key: "unknown" }
        skip
      },
      _ -> continue
    }
  }
}
```
