---
sidebar_position: 2
---

# For loops

For loops iterate over collections, allowing you to process each item individually.

## Basic syntax

```vague
for item in collection {
  // steps to execute for each item
}
```

## Iterating over response data

```vague
action ProcessUsers {
  get "/users"

  for user in response.data {
    store user -> users { key: .id }
  }
}
```

## Iterating over store data

```vague
action ProcessStoredData {
  for customer in customers {
    get concat("/customers/", customer.id, "/orders")
    store response -> orders { key: .id }
  }
}
```

## Filtering with where

Add conditions to filter items:

```vague
action ProcessActiveUsers {
  get "/users"

  // Single condition
  for user in response.data where .status == "active" {
    store user -> activeUsers { key: .id }
  }
}
```

### Multiple conditions

```vague
action ProcessPremiumActiveUsers {
  for user in users where .status == "active" and .tier == "premium" {
    // Process premium active users
  }
}
```

### Comparison operators

```vague
// Equality
for item in items where .status == "pending" { }

// Inequality
for item in items where .status != "cancelled" { }

// Numeric comparisons
for item in items where .price > 100 { }
for item in items where .quantity >= 10 { }
for item in items where .discount < 0.5 { }
for item in items where .stock <= 0 { }

// String contains
for item in items where .email contains "@example.com" { }

// Type checking
for item in items where .tags is array { }
```

### Complex conditions

```vague
for order in orders where (.status == "pending" or .status == "processing") and .total > 100 {
  // Process high-value pending/processing orders
}
```

## Nested loops

```vague
action ProcessOrderItems {
  for order in orders {
    for item in order.lineItems {
      map item -> OrderItem {
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        price: item.unitPrice
      }
      store item -> orderItems { key: concat(order.id, "-", item.productId) }
    }
  }
}
```

## Variable scope

Loop variables are scoped to their block:

```vague
action ScopedVariables {
  get "/users"

  for user in response.users {
    // user is available here

    for order in user.orders {
      // Both user and order are available

      map order -> EnrichedOrder {
        orderId: order.id,
        userId: user.id,
        userName: user.name
      }
    }
    // order is no longer available
  }
  // user is no longer available
}
```

## Accessing loop item properties

Use dot notation to access properties:

```vague
for user in users {
  // Direct access
  store user -> allUsers { key: .id }

  // Nested access
  validate user {
    assume .profile.email is string
  }

  // In expressions
  map user -> Output {
    fullName: concat(.firstName, " ", .lastName),
    domain: split(.email, "@")[1]
  }
}
```

## Iterating over paginated results

Combine pagination with iteration:

```vague
action FetchAllOrders {
  get "/orders" {
    paginate: offset(page, 100),
    until: length(response.orders) == 0
  }

  // This runs after ALL pages are fetched
  for order in response.orders {
    store order -> orders { key: .id }
  }
}
```

For processing each page separately:

```vague
action ProcessPagesSequentially {
  get "/orders" {
    paginate: offset(page, 100),
    until: length(response.orders) == 0
  }

  // Pagination accumulates all results in response
  // Then the for loop processes them
  for order in response.orders {
    match order {
      { status: "urgent" } -> {
        get concat("/orders/", order.id, "/expedite")
      },
      _ -> continue
    }
    store order -> orders { key: .id }
  }
}
```

## Breaking out of loops

Use `skip` in match to skip to the next iteration:

```vague
for user in users {
  match user {
    { status: "inactive" } -> skip,
    { status: "banned" } -> skip,
    _ -> continue
  }

  // Only runs for active, non-banned users
  store user -> activeUsers { key: .id }
}
```

## Error handling in loops

Handle errors per-item:

```vague
for user in users {
  get concat("/users/", user.id, "/details")

  match response {
    { error: _ } -> {
      // Log error and continue
      store { userId: user.id, error: response.error } -> errors { key: user.id }
      skip
    },
    _ -> continue
  }

  store response -> userDetails { key: user.id }
}
```

## Performance considerations

### Batch operations

Instead of individual requests:

```vague
// Less efficient: one request per user
for user in users {
  get concat("/users/", user.id)
}
```

Consider batching if the API supports it:

```vague
// More efficient: batch request
post "/users/batch" {
  body: { ids: users.map(.id) }
}
```

### Parallel processing

For independent operations, consider parallel actions:

```vague
run [FetchOrders, FetchProducts, FetchCustomers] then MergeData
```

## Complete example

```vague
mission OrderProcessing {
  source API { auth: bearer, base: "https://api.example.com" }

  store orders: file("orders")
  store enrichedOrders: file("enriched-orders")
  store errors: file("errors")

  action ProcessOrders {
    get "/orders" {
      paginate: offset(page, 100),
      until: length(response.data) == 0
    }

    for order in response.data where .status != "cancelled" {
      // Validate order
      validate order {
        assume .id is string,
        assume .total > 0,
        assume .items is array
      }

      // Fetch customer details
      get concat("/customers/", order.customerId)

      match response {
        { error: _ } -> {
          store { orderId: order.id, error: "Customer not found" } -> errors
          skip
        },
        _ -> continue
      }

      // Enrich order with customer data
      map order -> EnrichedOrder {
        id: order.id,
        total: order.total,
        status: order.status,
        customer: {
          id: response.id,
          name: response.name,
          email: response.email
        },
        items: order.items
      }

      store order -> enrichedOrders { key: .id }
    }
  }

  run ProcessOrders
}
```
