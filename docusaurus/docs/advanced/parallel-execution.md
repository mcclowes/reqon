---
sidebar_position: 3
---

# Parallel execution

Reqon runs independent actions in parallel when you group them in a pipeline stage.

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

The three actions run concurrently. Once all of them finish, `MergeResults` runs.

## Syntax

### Parallel group

```vague
run [Action1, Action2, Action3]
```

All actions in the bracket run together.

### Parallel then sequential

```vague
run [Fetch1, Fetch2] then Process then [Export1, Export2]
```

```
┌─ Fetch1 ─┐              ┌─ Export1 ─┐
│          ├─ Process ────┤           │
└─ Fetch2 ─┘              └─ Export2 ─┘
```

### Concurrency bound

Parallel stages run with a built-in limit of 8 actions in flight. If a bracket holds more than 8 actions, the rest start as earlier ones finish. There's no DSL option to change this bound.

## Conditional stages

Any stage can carry an `if` condition. The stage runs only when the condition evaluates truthy, otherwise it's skipped:

```vague
run FetchData then ProcessData if env.shouldProcess then Export
```

Conditions work on parallel stages too:

```vague
run [SyncA, SyncB] if env.fullSync then Reconcile
```

## Use cases

### Fetching from multiple sources

```vague
mission MultiSourceSync {
  source Xero { auth: oauth2, base: "https://api.xero.com" }
  source QuickBooks { auth: oauth2, base: "https://quickbooks.api.com" }
  source Stripe { auth: bearer, base: "https://api.stripe.com" }

  store xeroInvoices: memory("xero")
  store qbInvoices: memory("qb")
  store stripeInvoices: memory("stripe")

  action FetchXero {
    get "/invoices" { source: Xero }
    store response -> xeroInvoices { key: .InvoiceID }
  }

  action FetchQuickBooks {
    get "/invoices" { source: QuickBooks }
    store response -> qbInvoices { key: .Id }
  }

  action FetchStripe {
    get "/invoices" { source: Stripe }
    store response -> stripeInvoices { key: .id }
  }

  action Reconcile {
    // All invoices are now available across the shared stores
    for xero in xeroInvoices {
      // Cross-reference with the other sources
    }
  }

  run [FetchXero, FetchQuickBooks, FetchStripe] then Reconcile
}
```

### Fan-out, fan-in

```vague
mission FanOutFanIn {
  source API { auth: bearer, base: "https://api.example.com" }
  store items: memory("items")
  store pricing: memory("pricing")
  store inventory: memory("inventory")

  action FetchMaster {
    get "/items" { source: API }
    store response -> items { key: .id }
  }

  action EnrichWithPricing {
    for item in items {
      get concat("/pricing/", item.id) { source: API }
      store response -> pricing { key: item.id }
    }
  }

  action EnrichWithInventory {
    for item in items {
      get concat("/inventory/", item.id) { source: API }
      store response -> inventory { key: item.id }
    }
  }

  run FetchMaster then [EnrichWithPricing, EnrichWithInventory]
}
```

## Failure semantics

Parallel stages are complete-then-fail:

- Every branch runs to completion. There's no cancellation of siblings.
- After all branches finish, the stage fails if any branch failed.
- There's no rollback. A branch that wrote to a store keeps those writes even when a sibling fails.

```vague
run [ActionA, ActionB, ActionC]
// If ActionB fails, ActionA and ActionC still run to completion,
// then the stage reports the failure.
```

## Shared state

### Isolated action scope

Each branch gets its own action scope, so the step counter, checkpoints, and `response` are independent:

```vague
action ParallelA {
  get "/a" { source: API }  // its own response
}

action ParallelB {
  get "/b" { source: API }  // its own response, doesn't see A's
}
```

### Shared stores

Stores, sources, and schemas are shared across branches. Writes to the same key are last-writer-wins, so parallel branches should target disjoint keys:

```vague
action ParallelA {
  get "/a" { source: API }
  store response -> shared { key: concat("a-", .id) }
}

action ParallelB {
  get "/b" { source: API }
  store response -> shared { key: concat("b-", .id) }
}
```

## Best practices

### Group related operations

```vague
// Good: related fetches that have no ordering dependency
run [FetchOrders, FetchOrderItems, FetchOrderPayments] then ProcessOrders
```

### Use disjoint store keys

```vague
// Good: per-source key prefix avoids collisions
store response -> shared { key: concat(source, "-", .id) }

// Risky: branches may overwrite each other
store response -> shared { key: .id }
```

## Troubleshooting

### Actions not running in parallel

Check the bracket syntax:

```vague
run [A, B, C]      // parallel
run A then B then C // sequential
```

### Last-writer-wins surprises

If parallel branches write the same key, only the last write survives. Give each branch a distinct key prefix.
