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
    get "/customers/{customer.id}/orders"
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
for item in items where not (.status == "cancelled") { }

// Numeric comparisons
for item in items where .price > 100 { }
for item in items where .quantity >= 10 { }
for item in items where .discount < 0.5 { }
for item in items where .stock <= 0 { }

// Type checking
for item in items where .tags is array { }

// Null check
for item in items where not (.email == null) { }
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
      store item -> orderItems { key: order.id + "-" + item.productId }
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
    fullName: .firstName + " " + .lastName,
    email: .email
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
      _ where order.status == "urgent" -> {
        get "/orders/{order.id}/expedite"
      },
      _ -> continue
    }
    store order -> orders { key: .id }
  }
}
```

## Breaking out of loops

Use `skip` in a match arm to move on to the next iteration:

```vague
for user in users {
  match user {
    _ where user.status == "inactive" -> skip,
    _ where user.status == "banned" -> skip,
    _ -> continue
  }

  // Only runs for active, non-banned users
  store user -> activeUsers { key: .id }
}
```

## Error handling in loops

Handle errors per item with a schema or a guarded wildcard:

```vague
for user in users {
  get "/users/{user.id}/details"

  match response {
    // Log the failure and move on to the next user
    _ where response.error != null ->
      store { userId: user.id, error: response.error } -> errors { key: user.id },
    _ -> store response -> userDetails { key: user.id }
  }
}
```

:::note
A match arm is *either* a flow directive (`skip`, `continue`, `abort`, …) *or* a
block of steps, never both. So put the success path in its own arm rather than
storing in one arm and letting the rest of the iteration fall through.
:::

## Concurrency

Loops are sequential by default: one item finishes before the next starts. For
bulk fetches that means a worker issues one request at a time, which usually
leaves most of its rate limit unused.

`concurrency N` bounds how many iterations run at once:

```vague
action FetchManagers {
  for entry in shard concurrency 8 {
    get "/entry/{entry.id}/history/"
    store response -> managers { key: .id, upsert: true }
  }
}
```

It goes after the `where` clause when both are present:

```vague
for item in items where .status == "pending" concurrency 4 {
  // ...
}
```

### What is and isn't shared

Each iteration already runs in its own scope, so the loop variable and
`response` stay isolated. Stores are shared, so two iterations writing the same
key are last-writer-wins. Give concurrent iterations disjoint keys.

### Failure behaviour

On the first error the loop stops taking new items, lets the iterations already
in flight finish, then rethrows that error. Nothing is abandoned mid-write, but
the remaining items are not started.

### Interaction with other features

- **Rate limiting** still applies. Concurrency is an upper bound on iterations
  in flight, not a licence to exceed the source's configured rate. Pair a high
  concurrency with a [proxy pool](../http/rate-limiting.md) if you need the
  extra throughput to actually land.
- **The debugger** forces sequential iteration, so stepping stays deterministic.
- **Durable resume** is safe: concurrent iterations get their own step-index
  namespace derived from item position, so step ids stay stable across replays.

### Picking a number

Start at roughly the number of independent egress lanes you have, and raise it
only while the source keeps up. A concurrency far above what the rate limiter
allows just parks iterations in the limiter's queue.

## Performance considerations

### Batch operations

Instead of individual requests:

```vague
// Less efficient: one request per user
for user in users {
  get "/users/{user.id}"
}
```

Consider batching if the API supports it. Pass an array you already have in context as the body:

```vague
// More efficient: one batch request
post "/users/batch" {
  body: { ids: userIds }
}
```

### Parallel processing

To overlap iterations of one loop, use [`concurrency`](#concurrency). To run
different actions at the same time, use a parallel stage:

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
      get "/customers/{order.customerId}"

      match response {
        _ where response.error != null ->
          store { orderId: order.id, error: "Customer not found" } -> errors { key: order.id },

        // Enrich order with customer data
        _ -> {
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
    }
  }

  run ProcessOrders
}
```
