---
sidebar_position: 4
---

# Validation

Validate steps check data constraints before processing or storing. They help ensure data quality and catch issues early.

## Basic Syntax

```vague
validate target {
  assume constraint1,
  assume constraint2
}
```

## Simple Validation

```vague
action ValidateUsers {
  get "/users"

  for user in response.users {
    validate user {
      assume .id is string,
      assume length(.name) > 0,
      assume .email contains "@"
    }

    store user -> users { key: .id }
  }
}
```

## Constraint Types

### Type Checking

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

### Existence Checks

```vague
validate data {
  assume .id != null,
  assume .name != null,
  assume .email != null
}
```

### String Constraints

```vague
validate user {
  assume length(.name) > 0,
  assume length(.name) < 100,
  assume .email contains "@",
  assume .phone startsWith "+",
  assume .country endsWith "A"
}
```

### Numeric Constraints

```vague
validate order {
  assume .quantity > 0,
  assume .price >= 0,
  assume .discount >= 0 and .discount <= 100,
  assume .total == .price * .quantity
}
```

### Array Constraints

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

## Complex Constraints

### Logical Operators

```vague
validate user {
  assume .status == "active" or .status == "pending",
  assume .age >= 18 and .age <= 120,
  assume not (.status == "banned")
}
```

### Conditional Validation

```vague
validate order {
  // If discount is present, it must be valid
  assume .discount == null or (.discount >= 0 and .discount <= 50),

  // If status is shipped, must have tracking
  assume .status != "shipped" or .trackingNumber != null
}
```

## Validation Responses

### Warnings vs Errors

By default, failed validations are warnings and don't stop execution:

```vague
validate user {
  assume length(.name) > 0  // Warning if fails
}
// Execution continues even if validation fails
```

### Strict Validation

Combine with match for strict validation:

```vague
action StrictValidation {
  get "/users"

  for user in response.users {
    validate user {
      assume .id is string,
      assume .email contains "@"
    }

    match user {
      { id: null } -> skip,
      { email: null } -> skip,
      _ -> store user -> users { key: .id }
    }
  }
}
```

## Validating Nested Data

```vague
validate order {
  assume .id is string,
  assume .customer.id is string,
  assume .customer.email contains "@",
  assume length(.items) > 0,
  assume .items[0].quantity > 0
}
```

## Validating Arrays

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

## Custom Validation Messages

Use match for custom error handling:

```vague
action ValidateWithMessages {
  get "/users"

  for user in response.users {
    match user {
      { email: null } -> {
        store { userId: user.id, error: "Missing email" } -> validationErrors
        skip
      },
      { age: a } where a < 18 -> {
        store { userId: user.id, error: "User under 18" } -> validationErrors
        skip
      },
      _ -> continue
    }

    store user -> validUsers { key: .id }
  }
}
```

## Validation Before Store

Always validate before storing:

```vague
action SafeStore {
  get "/data"

  for item in response.data {
    validate item {
      assume .id is string,
      assume .value is number
    }

    // Only store if valid
    match item {
      { id: null } -> skip,
      { value: null } -> skip,
      _ -> store item -> data { key: .id }
    }
  }
}
```

## Validation Schemas

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

## Built-in Validation Functions

```vague
validate data {
  // String functions
  assume length(.name) > 0,
  assume .email contains "@",
  assume lowercase(.status) == "active",

  // Numeric functions
  assume abs(.balance) < 10000,
  assume round(.price, 2) == .price,

  // Array functions
  assume length(.items) > 0,
  assume includes(.roles, "user"),

  // Date functions
  assume .createdAt <= now(),
  assume .expiresAt > now()
}
```

## Complete Example

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
        assume .total == sum(.items.map(.price * .quantity)),
        assume .status == "pending" or .status == "confirmed"
      }

      // Route based on validation
      match order {
        ValidOrder where .total > 0 and length(.items) > 0 -> {
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

## Best Practices

### Validate Early

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

### Use Specific Constraints

```vague
// Good: specific constraints
validate user {
  assume .email contains "@",
  assume length(.email) > 5,
  assume .email endsWith ".com" or .email endsWith ".org"
}

// Avoid: too loose
validate user {
  assume .email is string
}
```

### Log Validation Failures

```vague
action ValidateWithLogging {
  for item in items {
    match item {
      { id: null } -> {
        store { itemId: "unknown", field: "id", error: "Missing" } -> errors
        skip
      },
      _ -> continue
    }
  }
}
```
