---
sidebar_position: 6
---

# Pipelines

Pipelines define the execution order of actions in a mission. They support sequential execution, parallel execution, and conditional flows.

## Basic syntax

```vague
run ActionName
run ActionA then ActionB
run [ActionA, ActionB] then ActionC
```

## Sequential execution

Execute actions one after another:

```vague
mission DataPipeline {
  action Fetch { /* ... */ }
  action Transform { /* ... */ }
  action Export { /* ... */ }

  run Fetch then Transform then Export
}
```

Each action completes before the next starts:

```
Fetch → Transform → Export
```

## Parallel execution

Execute multiple actions concurrently:

```vague
mission ParallelFetch {
  action FetchUsers { /* ... */ }
  action FetchOrders { /* ... */ }
  action FetchProducts { /* ... */ }

  run [FetchUsers, FetchOrders, FetchProducts]
}
```

Execution diagram:

```
┌─ FetchUsers ──┐
├─ FetchOrders ─┼─→
└─ FetchProducts┘
```

## Parallel then sequential

Combine parallel and sequential:

```vague
mission ComplexPipeline {
  action FetchCustomers { /* ... */ }
  action FetchProducts { /* ... */ }
  action MergeData { /* ... */ }
  action Export { /* ... */ }

  run [FetchCustomers, FetchProducts] then MergeData then Export
}
```

Execution:

```
┌─ FetchCustomers ─┐
├─────────────────→┼─ MergeData ─→ Export
└─ FetchProducts ──┘
```

## Multiple parallel groups

```vague
mission MultiPhase {
  // Phase 1: Fetch all data sources
  action FetchA { }
  action FetchB { }
  action FetchC { }

  // Phase 2: Transform in parallel
  action TransformA { }
  action TransformB { }

  // Phase 3: Final merge
  action Merge { }

  run [FetchA, FetchB, FetchC]
    then [TransformA, TransformB]
    then Merge
}
```

## Single action

Run a single action:

```vague
mission SimpleSync {
  action Sync {
    get "/data"
    store response -> data { key: .id }
  }

  run Sync
}
```

## Action dependencies

Actions run in order share context:

```vague
mission DependentActions {
  store customers: memory("customers")
  store orders: memory("orders")

  action FetchCustomers {
    get "/customers"
    store response -> customers { key: .id }
  }

  action FetchOrders {
    // Can access customers store populated by previous action
    for customer in customers {
      get "/customers/{customer.id}/orders"
      store response -> orders { key: .id }
    }
  }

  run FetchCustomers then FetchOrders
}
```

## Parallel action isolation

Parallel actions have isolated contexts:

```vague
mission ParallelIsolation {
  store results: memory("results")

  action ProcessA {
    get "/data-a"
    store response -> results { key: "a-" + .id }
  }

  action ProcessB {
    get "/data-b"
    store response -> results { key: "b-" + .id }
  }

  // Both write to same store, but with different key prefixes
  run [ProcessA, ProcessB]
}
```

## Error handling in pipelines

### Sequential error handling

Errors in sequential pipelines stop execution:

```vague
run Fetch then Transform then Export
// If Transform fails, Export never runs
```

### Parallel error handling

In parallel groups, all actions run even if one fails:

```vague
run [FetchA, FetchB, FetchC] then Merge
// If FetchB fails, FetchA and FetchC still complete
// Merge runs but FetchB data is missing
```

## Conditional stages

Each stage can carry an `if` condition. The stage runs only when the condition is true:

```vague
run Sync if env("FULL_SYNC") == "true"

// Works for parallel stages too
run [ExportWarehouse, ExportAnalytics] if env("EXPORT") == "true"
```

Conditions are mission-level. You can't put `run` inside an action or a match arm; the pipeline is declared once at the end of the mission.

## Common pipeline patterns

### ETL pipeline

```vague
mission ETL {
  action Extract {
    get "/source-data"
    store response -> raw { key: .id }
  }

  action Transform {
    for item in raw {
      map item -> Transformed { /* ... */ }
      store item -> transformed { key: .id }
    }
  }

  action Load {
    for item in transformed {
      post "/destination" { body: item }
    }
  }

  run Extract then Transform then Load
}
```

### Fan-out fan-in

```vague
mission FanOutFanIn {
  action FetchMain {
    get "/items"
    store response -> items { key: .id }
  }

  action EnrichA {
    for item in items {
      get "/enrichA/{item.id}"
      store response -> enrichA { key: item.id }
    }
  }

  action EnrichB {
    for item in items {
      get "/enrichB/{item.id}"
      store response -> enrichB { key: item.id }
    }
  }

  action Combine {
    for item in items {
      map item -> Enriched {
        id: item.id,
        dataA: enrichA[item.id],
        dataB: enrichB[item.id]
      }
      store item -> enriched { key: .id }
    }
  }

  run FetchMain then [EnrichA, EnrichB] then Combine
}
```

### Conditional pipeline

Use `if` conditions on stages to choose a path. The condition can read environment variables and data already in context:

```vague
mission ConditionalPipeline {
  store data: file("data")

  action FullSync {
    get "/all-data"
    store response -> data { key: .id }
  }

  action IncrementalSync {
    get "/data" { since: lastSync }
    store response -> data { key: .id, upsert: true }
  }

  run FullSync if env("FULL_SYNC") == "true"
    then IncrementalSync if env("FULL_SYNC") != "true"
}
```

### Retry pipeline

```vague
mission RetryPipeline {
  store data: file("data")

  schema ErrorResponse {
    error: string
  }

  action FetchWithRetry {
    get "/unreliable-endpoint" {
      retry: { maxAttempts: 3, backoff: exponential }
    }

    match response {
      ErrorResponse -> abort "Failed after retries",
      _ -> store response -> data { key: .id }
    }
  }

  action ProcessData { /* ... */ }

  run FetchWithRetry then ProcessData
}
```

## Best practices

### Group related fetches

```vague
// Good: related fetches in parallel
run [FetchOrders, FetchOrderItems, FetchOrderPayments] then ProcessOrders

// Avoid: unrelated data
run [FetchOrders, FetchUsers, FetchProducts] then ???
```

### Keep actions focused

```vague
// Good: single responsibility
action FetchUsers { }
action TransformUsers { }
action ExportUsers { }

run FetchUsers then TransformUsers then ExportUsers

// Avoid: monolithic action
action DoEverything { }
run DoEverything
```

### Handle dependencies explicitly

```vague
mission ExplicitDependencies {
  action FetchParent {
    get "/parents"
    store response -> parents { key: .id }
  }

  action FetchChildren {
    // Explicitly depends on parents
    for parent in parents {
      get "/parents/{parent.id}/children"
      store response -> children { key: .id }
    }
  }

  // Order enforces dependency
  run FetchParent then FetchChildren
}
```

### Document complex pipelines

```vague
mission DocumentedPipeline {
  // Phase 1: Data Collection
  action FetchCustomers { }
  action FetchOrders { }
  action FetchProducts { }

  // Phase 2: Enrichment
  action EnrichOrders { }

  // Phase 3: Export
  action ExportToWarehouse { }
  action ExportToAnalytics { }

  // Execution: Collect → Enrich → Export
  run [FetchCustomers, FetchOrders, FetchProducts]
    then EnrichOrders
    then [ExportToWarehouse, ExportToAnalytics]
}
```
