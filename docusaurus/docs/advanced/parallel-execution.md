---
sidebar_position: 3
---

# Parallel execution

Reqon supports parallel execution of independent actions for improved performance.

## Basic parallel execution

```vague
run [ActionA, ActionB, ActionC] then MergeResults
```

Execution:
```
┌─ ActionA ─┐
├─ ActionB ─┼─ MergeResults
└─ ActionC ─┘
```

## Syntax

### Parallel group

```vague
run [Action1, Action2, Action3]
```

All actions run simultaneously.

### Parallel then sequential

```vague
run [Fetch1, Fetch2] then Process then [Export1, Export2]
```

```
┌─ Fetch1 ─┐     ┌─ Export1 ─┐
├──────────┼─ Process ─┼────────────┤
└─ Fetch2 ─┘     └─ Export2 ─┘
```

## Use cases

### Fetching from multiple sources

```vague
mission MultiSourceSync {
  source Xero { auth: oauth2, base: "https://api.xero.com" }
  source QuickBooks { auth: oauth2, base: "https://quickbooks.api.com" }
  source Stripe { auth: bearer, base: "https://api.stripe.com" }

  action FetchXero {
    get Xero "/invoices"
    store response -> xeroInvoices { key: .InvoiceID }
  }

  action FetchQuickBooks {
    get QuickBooks "/invoices"
    store response -> qbInvoices { key: .Id }
  }

  action FetchStripe {
    get Stripe "/invoices"
    store response -> stripeInvoices { key: .id }
  }

  action Reconcile {
    // All invoices are now available
    for xero in xeroInvoices {
      // Cross-reference with other sources
    }
  }

  // Fetch all in parallel, then reconcile
  run [FetchXero, FetchQuickBooks, FetchStripe] then Reconcile
}
```

### Independent processing

```vague
mission DataProcessing {
  action ProcessCustomers {
    for customer in rawCustomers {
      // Transform customers
    }
  }

  action ProcessOrders {
    for order in rawOrders {
      // Transform orders
    }
  }

  action ProcessProducts {
    for product in rawProducts {
      // Transform products
    }
  }

  action GenerateReports {
    // Uses all processed data
  }

  run [ProcessCustomers, ProcessOrders, ProcessProducts] then GenerateReports
}
```

### Fan-out fan-in

```vague
mission FanOutFanIn {
  action FetchMaster {
    get "/items"
    store response -> items { key: .id }
  }

  action EnrichWithPricing {
    for item in items {
      get "/pricing" { params: { itemId: item.id } }
      store response -> pricing { key: item.id }
    }
  }

  action EnrichWithInventory {
    for item in items {
      get "/inventory" { params: { itemId: item.id } }
      store response -> inventory { key: item.id }
    }
  }

  action Combine {
    for item in items {
      map item -> EnrichedItem {
        ...item,
        price: pricing[item.id].price,
        stock: inventory[item.id].quantity
      }
      store item -> enrichedItems { key: .id }
    }
  }

  run FetchMaster then [EnrichWithPricing, EnrichWithInventory] then Combine
}
```

## Concurrency control

### Limit parallel actions

```vague
mission ControlledParallel {
  maxConcurrency: 3

  run [A, B, C, D, E] then Finish
  // Runs 3 at a time: [A,B,C], then [D,E]
}
```

### Per-action limits

```vague
action FetchWithLimit {
  concurrency: 5  // Max 5 concurrent requests within this action

  for item in items parallel {
    get concat("/items/", item.id)
  }
}
```

## Error handling

### Default behavior

All parallel actions run even if one fails:

```vague
run [ActionA, ActionB, ActionC]
// If ActionB fails, ActionA and ActionC still complete
```

### Fail-fast mode

```vague
mission FailFast {
  parallelMode: "fail-fast"

  run [ActionA, ActionB, ActionC]
  // If ActionB fails, cancel ActionA and ActionC
}
```

### Handling partial results

```vague
action Merge {
  // Check which sources succeeded
  match {
    length(dataA) > 0 and length(dataB) > 0 -> {
      // Full merge
    },
    length(dataA) > 0 -> {
      // Partial merge - only A available
    },
    _ -> abort "No data available"
  }
}
```

## Shared state

### Isolated contexts

Parallel actions have isolated variable contexts:

```vague
action ParallelA {
  // Sets its own 'response'
  get "/a"
}

action ParallelB {
  // Has its own 'response', doesn't see A's
  get "/b"
}
```

### Shared stores

All actions can write to shared stores:

```vague
action ParallelA {
  get "/a"
  store response -> shared { key: concat("a-", .id) }
}

action ParallelB {
  get "/b"
  store response -> shared { key: concat("b-", .id) }
}
```

## Performance considerations

### When to use parallel

| Scenario | Recommendation |
|----------|----------------|
| Independent API calls | Parallel |
| Rate-limited API | Sequential |
| Data dependencies | Sequential |
| Mixed workload | Hybrid |

### Memory usage

Parallel execution uses more memory:

```vague
// Memory-efficient: process and discard
run Fetch then Process then Export

// Higher memory: all data in memory at once
run [FetchA, FetchB, FetchC] then Combine
```

### Network saturation

Too much parallelism can saturate network:

```vague
// May overwhelm API
run [A, B, C, D, E, F, G, H, I, J]

// Better: limited parallelism
maxConcurrency: 3
run [A, B, C, D, E, F, G, H, I, J]
```

## Best practices

### Group related operations

```vague
// Good: related fetches together
run [FetchOrders, FetchOrderItems, FetchOrderPayments] then ProcessOrders

// Avoid: unrelated operations
run [FetchOrders, SendEmails, CleanupLogs]
```

### Balance parallelism

```vague
// Good: measured parallelism
maxConcurrency: 5
run [A, B, C, D, E, F, G, H] then Merge

// Risky: unlimited parallelism
run [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P]
```

### Handle failures gracefully

```vague
action Merge {
  match {
    length(errors) > 0 -> {
      store { errors: errors, partial: true } -> mergeLog
      // Continue with available data
    },
    _ -> continue
  }
}
```

## Troubleshooting

### Actions not running in parallel

Check syntax uses brackets:

```vague
// This is parallel
run [A, B, C]

// This is sequential
run A then B then C
```

### Race conditions

Use unique keys when writing to shared stores:

```vague
// Good: unique keys
store response -> shared { key: concat(source, "-", .id) }

// Risky: may collide
store response -> shared { key: .id }
```

### Memory issues

Reduce parallelism or process in batches:

```vague
maxConcurrency: 2
run [A, B, C, D, E, F]
```
