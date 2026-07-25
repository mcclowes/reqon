---
sidebar_position: 1
description: Learn about Reqon missions - the top-level container defining complete data pipelines with sources, stores, actions, and execution flow.
keywords: [reqon, mission, data pipeline, actions, sources, stores]
---

# Missions

A **Mission** is the top-level container in Reqon. It defines a complete data pipeline, including all the sources, stores, schemas, actions, and the execution flow.

## Basic structure

```vague
mission MissionName {
  // Source definitions (APIs)
  source SourceName { auth: type, base: "url" }

  // Store definitions (data persistence)
  store storeName: adapter("identifier")

  // Schema definitions (for validation and matching)
  schema SchemaName { field: type }

  // Action definitions (processing logic)
  action ActionName {
    // steps...
  }

  // Pipeline definition (execution order)
  run ActionName then AnotherAction
}
```

## Mission components

### Sources

Define the APIs your mission connects to:

```vague
mission DataSync {
  source MainAPI {
    auth: bearer,
    base: "https://api.example.com/v1"
  }

  source BackupAPI {
    auth: api_key,
    base: "https://backup.example.com"
  }
}
```

### Stores

Define where data is persisted:

```vague
mission DataSync {
  store customers: file("customers")
  store orders: memory("orders")
  store products: postgrest("products")
}
```

### Schemas

Define data shapes for validation and pattern matching:

```vague
mission DataSync {
  schema Customer {
    id: string,
    name: string,
    email: string,
    createdAt: date?
  }

  schema ErrorResponse {
    error: string,
    code: number
  }
}
```

For schema syntax details, see the [Vague documentation](https://github.com/mcclowes/vague).

### Actions

Define the processing logic:

```vague
mission DataSync {
  action FetchCustomers {
    get "/customers"
    store response -> customers { key: .id }
  }

  action ProcessOrders {
    for customer in customers {
      get "/orders?customerId=" + customer.id
      store response -> orders { key: .id }
    }
  }
}
```

### Pipeline

Define execution order:

```vague
mission DataSync {
  // Sequential execution
  run FetchCustomers then ProcessOrders

  // Or parallel execution
  run [FetchProducts, FetchCategories] then MergeData
}
```

## Multiple missions

A Reqon file can contain multiple missions:

```vague
mission SyncCustomers {
  source API { auth: bearer, base: "https://api.example.com" }
  store customers: file("customers")

  action Fetch {
    get "/customers"
    store response -> customers { key: .id }
  }

  run Fetch
}

mission SyncOrders {
  source API { auth: bearer, base: "https://api.example.com" }
  store orders: file("orders")

  action Fetch {
    get "/orders"
    store response -> orders { key: .id }
  }

  run Fetch
}
```

## Scheduled missions

Add a schedule to run missions automatically:

```vague
mission DailySync {
  schedule: every 6 hours

  source API { auth: bearer, base: "https://api.example.com" }
  store data: file("data")

  action Sync {
    get "/data" { since: lastSync }
    store response -> data { key: .id }
  }

  run Sync
}
```

See [Scheduling](../category/scheduling) for more details.

## Mission options

A mission can carry a few top-level settings alongside its sources, stores, schemas, actions, and pipeline:

- `schedule:` — run the mission automatically (see [Scheduling](../category/scheduling)).
- `checkpoint:` — durable execution, either `afterStep` or `onFailure`.
- `trace:` — time-travel debugging, either `full` or `minimal`.

```vague
mission RobustSync {
  // Scheduling
  schedule: cron "0 */6 * * *"

  // Durable execution: checkpoint after each step
  checkpoint: afterStep

  // Record a full trace for time-travel debugging
  trace: full

  // ... sources, stores, actions ...
}
```

Concurrency control, skip-if-running, and retry-on-failure are not mission-level options. They live inside the `schedule:` block:

```vague
mission RobustSync {
  schedule: cron "0 */6 * * *" {
    maxConcurrency: 5,
    skipIfRunning: true,
    retry: {
      maxRetries: 3,
      delaySeconds: 60
    }
  }

  // ... sources, stores, actions ...
}
```

## Best practices

### Keep missions focused

Each mission should have a single responsibility:

```vague
// Good: focused mission
mission SyncInvoices {
  // Only deals with invoices
}

mission SyncPayments {
  // Only deals with payments
}
```

### Use descriptive names

```vague
// Good
mission SyncXeroInvoicesToQuickBooks { }

// Avoid
mission Sync1 { }
```

### Organize complex missions

For complex pipelines, use [multi-file missions](../advanced/multi-file-missions):

```
missions/
└── invoice-sync/
    ├── mission.vague     # Main definition
    ├── fetch.vague       # Fetch actions
    ├── transform.vague   # Transform actions
    └── export.vague      # Export actions
```

### Handle errors gracefully

Always include error handling:

```vague
mission RobustSync {
  action FetchData {
    get "/data"

    match response {
      ErrorResponse -> queue dlq,
      _ -> store response -> data { key: .id }
    }
  }
}
```

## Execution context

When a mission runs, Reqon creates an execution context that includes:

- **stores**: Map of named store adapters
- **sources**: Map of named HTTP clients
- **schemas**: Map of named schema definitions
- **variables**: Runtime variables (loop variables, etc.)
- **response**: Last HTTP response

This context is passed through the entire pipeline, allowing actions to share data.
