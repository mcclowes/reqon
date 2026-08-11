# Reqon Examples

## Simple API Sync

```vague
mission SyncUsers {
  source API {
    auth: bearer,
    base: "https://api.example.com"
  }

  store users: memory("users")

  action FetchUsers {
    get "/users" {
      paginate: page(page, 50),
      until: length(response) == 0
    }
    store response -> users { key: .id }
  }

  run FetchUsers
}
```

## Multi-File Mission Structure

```text
project/
├── mission.vague        # Main: sources, stores, schemas, pipeline
├── fetch-data.vague     # Action: FetchData
├── transform.vague      # Action: Transform
└── validate.vague       # Action: Validate
```

Actions in separate files are automatically merged into the mission.

## Error Handling with Match

```vague
action FetchWithErrorHandling {
  get "/data"

  match response {
    [DataSchema] -> {
      store response -> data { key: .id }
    },

    RateLimitError -> retry {
      maxAttempts: 5,
      backoff: exponential,
      initialDelay: 60000
    },

    AuthError -> jump RefreshToken then retry,

    NotFoundError -> abort "Resource not found",

    _ -> {
      store {
        error: "Unexpected response",
        response: response,
        timestamp: now()
      } -> errors { key: now() }
    }
  }
}
```

## Data Transformation Pipeline

```vague
action TransformData {
  for item in raw_items {
    map item -> NormalizedItem {
      id: "item_" + .id,
      title: .name,
      description: .body,
      status: match .state {
        "open" => "active",
        "closed" => "completed",
        _ => "unknown"
      },
      author: .user.login,
      created_at: .created_at,
      synced_at: now()
    }

    validate response {
      assume length(.title) > 0
      assume .id != null
    }

    store response -> normalized_items {
      key: .id,
      upsert: true
    }
  }
}
```

## Parallel Execution

```vague
mission ParallelSync {
  source GitHubAPI { auth: bearer, base: "https://api.github.com" }

  store issues: memory("issues")
  store prs: memory("prs")
  store work_items: memory("work_items")

  action FetchIssues {
    get "/repos/{owner}/{repo}/issues"
    store response -> issues { key: .id }
  }

  action FetchPRs {
    get "/repos/{owner}/{repo}/pulls"
    store response -> prs { key: .id }
  }

  action Normalize {
    // Process both issues and PRs after parallel fetch
    for issue in issues {
      store issue -> work_items { key: .id, upsert: true }
    }
    for pr in prs {
      store pr -> work_items { key: .id, upsert: true }
    }
  }

  // FetchIssues and FetchPRs run in parallel, then Normalize
  run [FetchIssues, FetchPRs] then Normalize
}
```

## Incremental Sync

```vague
action IncrementalFetch {
  get "/items" {
    body: { "updated_after": lastSync },
    since: lastSync
  }
  store response -> items { key: .id, upsert: true }
}
```

## Dead Letter Queue Pattern

```vague
action ProcessWithDLQ {
  for item in pending {
    post "/process/{item.id}"

    match response {
      SuccessSchema -> {
        store response -> completed { key: .id }
      },

      TransientError -> retry {
        maxAttempts: 3,
        backoff: exponential,
        initialDelay: 1000
      },

      // After retries exhausted or permanent error, queue for later
      _ -> queue dead_letter_queue
    }
  }
}
```

## Conditional Processing

Filter iteration on the record's own fields. (A cross-store "not already in the
fraud queue" check isn't expressible inline — a store can't be read from an
expression — so carry the flag on the record itself.)

```vague
action ProcessConditionally {
  for payment in pending_payments
    where .fraud_checked == true and .fraud_flagged == false {

    post "/payments/{payment.id}/capture"

    match response {
      PaymentSuccess -> {
        store response -> completed { key: .id }
      },
      _ -> skip
    }
  }
}
```

## OpenAPI Integration

```vague
mission OpenAPIExample {
  source API from "./openapi.yaml" {
    auth: bearer,
    base: "https://api.example.com"
  }

  store users: memory("users")

  action FetchUsers {
    // Use operation ID from OpenAPI spec. Method and path come from the spec.
    // There is no `query:` option — the query string is built from `paginate`
    // and `since` only. For an arbitrary fixed param, use a plain
    // `get "/users?limit=100"` instead of a `call`.
    call API.listUsers {
      paginate: page(page, 100),
      until: length(response) == 0
    }
    store response -> users { key: .id }
  }

  run FetchUsers
}
```

## Webhook/Callback Workflow

```vague
mission PaymentWorkflow {
  source API { auth: bearer, base: "https://api.example.com" }
  store orders: memory("orders")
  store payments: memory("payments")

  action ProcessOrder {
    post "/orders" {
      body: { item: "test" }
    }

    // Wait for payment webhook callback
    wait {
      timeout: 300000,
      path: "/webhooks/payment",
      eventFilter: .status == "completed",
      storage: {
        target: payments,
        key: .order_id
      }
    }

    store response -> orders { key: .id }
  }

  run ProcessOrder
}
```

## Scheduled Mission

```vague
mission DailySyncWithSchedule {
  schedule: cron "0 9 * * 1-5" {
    timezone: "Europe/London",
    skipIfRunning: true,
    retry: { maxRetries: 3, delaySeconds: 60 }
  }

  source API { auth: bearer, base: "https://api.example.com" }
  store data: memory("data")

  action Sync {
    get "/data" { since: lastSync }
    store response -> data { key: .id, upsert: true }
  }

  run Sync
}
```
