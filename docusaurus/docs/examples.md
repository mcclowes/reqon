---
sidebar_position: 20
description: Real-world Reqon examples including Xero integration, multi-source reconciliation, OpenAPI, error handling with DLQ, and scheduled syncs.
keywords: [reqon, examples, Xero, Shopify, Stripe, GitHub, OAuth2, pagination]
---

# Examples

Real-world examples demonstrating Reqon's capabilities.

## Basic API sync

Fetch and store data from a public API:

```vague
mission JSONPlaceholderSync {
  source API {
    auth: none,
    base: "https://jsonplaceholder.typicode.com"
  }

  store posts: file("posts")
  store users: file("users")

  action FetchPosts {
    get "/posts"

    for post in response {
      store post -> posts { key: .id }
    }
  }

  action FetchUsers {
    get "/users"

    for user in response {
      map user -> User {
        id: .id,
        name: .name,
        email: lowercase(.email),
        company: .company.name
      }
      store user -> users { key: .id }
    }
  }

  run [FetchPosts, FetchUsers]
}
```

## Xero integration

Sync invoices from Xero with OAuth2 authentication:

```vague
mission XeroInvoiceSync {
  source Xero {
    auth: oauth2,
    base: "https://api.xero.com/api.xro/2.0",
    headers: {
      "Xero-Tenant-Id": env("XERO_TENANT_ID")
    }
  }

  store invoices: file("xero-invoices")
  store errors: file("sync-errors")

  schema XeroInvoice {
    InvoiceID: string,
    InvoiceNumber: string,
    Contact: object,
    Total: number,
    Status: string
  }

  schema ErrorResponse {
    error: string,
    code: number
  }

  action FetchInvoices {
    get "/Invoices" {
      paginate: page(page, 100),
      until: length(response.Invoices) == 0,
      since: lastSync
    }

    match response {
      ErrorResponse where .code == 401 -> jump RefreshToken then retry,
      ErrorResponse -> queue errors,
      _ -> continue
    }

    for invoice in response.Invoices {
      map invoice -> StandardInvoice {
        id: .InvoiceID,
        number: .InvoiceNumber,
        customerId: .Contact.ContactID,
        customerName: .Contact.Name,
        amount: .Total,
        status: lowercase(.Status),
        source: "xero"
      }
      store invoice -> invoices { key: .id, upsert: true }
    }
  }

  action RefreshToken {
    post "https://identity.xero.com/connect/token" {
      body: {
        grant_type: "refresh_token",
        refresh_token: env("XERO_REFRESH_TOKEN"),
        client_id: env("XERO_CLIENT_ID"),
        client_secret: env("XERO_CLIENT_SECRET")
      }
    }
  }

  run FetchInvoices
}
```

## Multi-source reconciliation

Sync and reconcile data from multiple sources:

```vague
mission OrderReconciliation {
  source Shopify { auth: bearer, base: "https://mystore.myshopify.com/admin/api/2024-01" }
  source Stripe { auth: bearer, base: "https://api.stripe.com/v1" }
  source Warehouse { auth: api_key, base: "https://warehouse.example.com/api" }

  store shopifyOrders: memory("shopify")
  store stripePayments: memory("stripe")
  store warehouseShipments: memory("warehouse")
  store reconciledOrders: file("reconciled")
  store discrepancies: file("discrepancies")

  action FetchShopify {
    get "/orders.json?status=any&limit=250" {
      source: Shopify,
      paginate: cursor(page_info, 250, "link.next"),
      until: response.orders == null or length(response.orders) == 0
    }

    for order in response.orders {
      store order -> shopifyOrders { key: .id }
    }
  }

  action FetchStripe {
    get "/payment_intents?limit=100" {
      source: Stripe,
      paginate: cursor(starting_after, 100, "data[length(data)-1].id"),
      until: response.has_more == false
    }

    for payment in response.data {
      store payment -> stripePayments { key: .id }
    }
  }

  action FetchWarehouse {
    get "/shipments" {
      source: Warehouse,
      paginate: offset(offset, 100),
      until: length(response.shipments) == 0
    }

    for shipment in response.shipments {
      store shipment -> warehouseShipments { key: .order_id }
    }
  }

  action Reconcile {
    for order in shopifyOrders {
      // Find matching payment
      for payment in stripePayments where .metadata.order_id == order.id {
        // Find matching shipment
        for shipment in warehouseShipments where .order_id == order.id {
          map order -> ReconciledOrder {
            orderId: order.id,
            orderAmount: order.total_price,
            paymentId: payment.id,
            paymentAmount: payment.amount / 100,
            shipmentId: shipment.id,
            shipmentStatus: shipment.status,
            amountMatch: order.total_price == payment.amount / 100,
            isShipped: shipment.status == "delivered"
          }

          match order {
            _ where order.amountMatch == false -> {
              store order -> discrepancies { key: .orderId }
            },
            _ -> store order -> reconciledOrders { key: .orderId }
          }
        }
      }
    }
  }

  run [FetchShopify, FetchStripe, FetchWarehouse] then Reconcile
}
```

## OpenAPI integration

Use OpenAPI spec for type-safe API calls:

```vague
mission PetstoreSync {
  source Petstore from "https://petstore3.swagger.io/api/v3/openapi.json" {
    auth: api_key,
    validateResponses: true
  }

  store pets: file("pets")
  store newPets: file("new-pets")

  schema Pet {
    id: number,
    name: string
  }

  action FetchAllPets {
    call Petstore.findPetsByStatus

    for pet in response {
      validate pet {
        assume .id is number,
        assume .name is string
      }
      store pet -> pets { key: .id }
    }
  }

  action CreatePet {
    for pet in newPets {
      call Petstore.addPet {
        body: {
          name: pet.name,
          photoUrls: pet.photos,
          status: "available"
        }
      }

      match response {
        Pet -> store response -> pets { key: .id },
        _ -> continue
      }
    }
  }

  run FetchAllPets
}
```

OAS `call` steps take the same option block as `get`/`post` (`paginate`, `until`, `retry`, `body`, and so on). Query parameters aren't a separate option; fold them into the operation as the spec requires.

## Error handling with dead letter queue

Robust error handling with retry and DLQ:

```vague
mission RobustSync {
  source API {
    auth: bearer,
    base: "https://api.example.com",
    rateLimit: { strategy: throttle, fallbackRpm: 60 },
    circuitBreaker: { failureThreshold: 5, resetTimeout: 30000 }
  }

  store data: file("data")
  store dlq: file("dead-letter-queue")
  store processed: file("processed")

  schema SuccessResponse { data: object }
  schema RateLimitError { error: string, retryAfter: number }
  schema AuthError { error: string, code: number }
  schema BadData { error: string, details: array }

  action FetchWithRetry {
    get "/items" {
      paginate: offset(offset, 100),
      until: length(response.data) == 0,
      retry: { maxAttempts: 3, backoff: exponential }
    }

    match response {
      RateLimitError -> retry { maxAttempts: 5 },
      AuthError where .code == 401 -> jump RefreshAuth then retry,
      AuthError -> abort "Authentication failed",
      BadData -> queue dlq,
      SuccessResponse -> continue,
      _ -> abort "Unexpected response"
    }

    for item in response.data {
      store item -> data { key: .id }
    }
  }

  action ProcessItems {
    for item in data where .processed == false {
      get concat("/items/", item.id, "/process")

      match response {
        BadData -> queue dlq,
        _ -> store item -> processed { key: .id }
      }
    }
  }

  action RefreshAuth {
    post "/auth/refresh" {
      body: { refreshToken: env("REFRESH_TOKEN") }
    }
  }

  run FetchWithRetry then ProcessItems
}
```

## Scheduled incremental sync

Regular incremental sync with scheduling:

```vague
mission ScheduledSync {
  schedule: every 15 minutes {
    skipIfRunning: true
  }

  source API {
    auth: oauth2,
    base: "https://api.example.com"
  }

  store customers: sql("customers")
  store orders: sql("orders")
  store syncLog: file("sync-log")

  action SyncCustomers {
    store { task: "SyncCustomers", started: now() } -> syncLog { key: .task }

    get "/customers" {
      since: lastSync,
      paginate: cursor(after, 100, "cursor.next"),
      until: response.cursor.next == null
    }

    for customer in response.data {
      store customer -> customers { key: .id, upsert: true }
    }

    store {
      task: "SyncCustomers",
      completed: now(),
      count: length(response.data)
    } -> syncLog { key: .task }
  }

  action SyncOrders {
    store { task: "SyncOrders", started: now() } -> syncLog { key: .task }

    get "/orders" {
      since: lastSync,
      paginate: cursor(after, 100, "cursor.next"),
      until: response.cursor.next == null
    }

    for order in response.data {
      store order -> orders { key: .id, upsert: true }
    }

    store {
      task: "SyncOrders",
      completed: now(),
      count: length(response.data)
    } -> syncLog { key: .task }
  }

  run [SyncCustomers, SyncOrders]
}
```

## GitHub repository sync

Sync repository data from GitHub:

```vague
mission GitHubSync {
  source GitHub {
    auth: bearer,
    base: "https://api.github.com",
    headers: {
      "Accept": "application/vnd.github.v3+json"
    }
  }

  store repos: file("repos")
  store issues: file("issues")
  store pullRequests: file("pull-requests")

  action FetchRepos {
    get "/user/repos?per_page=100&sort=updated" {
      paginate: page(page, 100),
      until: length(response) < 100
    }

    for repo in response {
      map repo -> Repository {
        id: .id,
        name: .name,
        fullName: .full_name,
        description: .description,
        stars: .stargazers_count,
        forks: .forks_count,
        language: .language,
        updatedAt: .updated_at
      }
      store repo -> repos { key: .id }
    }
  }

  action FetchIssues {
    for repo in repos where .open_issues_count > 0 {
      get concat("/repos/", repo.fullName, "/issues?state=open&per_page=100") {
        paginate: page(page, 100),
        until: length(response) < 100
      }

      for issue in response where .pull_request == null {
        map issue -> Issue {
          id: .id,
          repoId: repo.id,
          number: .number,
          title: .title,
          state: .state,
          author: .user.login,
          createdAt: .created_at
        }
        store issue -> issues { key: .id }
      }
    }
  }

  action FetchPRs {
    for repo in repos {
      get concat("/repos/", repo.fullName, "/pulls?state=open&per_page=100")

      for pr in response {
        map pr -> PullRequest {
          id: .id,
          repoId: repo.id,
          number: .number,
          title: .title,
          author: .user.login,
          branch: .head.ref,
          createdAt: .created_at
        }
        store pr -> pullRequests { key: .id }
      }
    }
  }

  run FetchRepos then [FetchIssues, FetchPRs]
}
```

## Runnable example projects

The repository ships a set of complete, runnable example projects in the [`examples/` directory](https://github.com/mcclowes/reqon/tree/main/examples). Each is a mission you can run with `node dist/cli.js examples/<name>/<file>.vague` after `npm run build`.

| Example | What it shows |
|---------|---------------|
| [jsonplaceholder](https://github.com/mcclowes/reqon/tree/main/examples/jsonplaceholder) | Basic public-API sync: `auth: none`, fetch, map, for loops |
| [petstore](https://github.com/mcclowes/reqon/tree/main/examples/petstore) | OpenAPI spec integration with `call` and cursor pagination |
| [xero](https://github.com/mcclowes/reqon/tree/main/examples/xero) | OAuth2 invoice sync with match steps and flow control |
| [github-sync](https://github.com/mcclowes/reqon/tree/main/examples/github-sync) | Multi-file (folder) mission, parallel execution, schema matching |
| [multi-source-sync](https://github.com/mcclowes/reqon/tree/main/examples/multi-source-sync) | Fetching from several sources into separate stores |
| [error-handling](https://github.com/mcclowes/reqon/tree/main/examples/error-handling) | Flow-control directives and dead-letter queues |
| [temporal-comparison](https://github.com/mcclowes/reqon/tree/main/examples/temporal-comparison) | Multi-source reconciliation with rate limiting |
| [incremental-sync](https://github.com/mcclowes/reqon/tree/main/examples/incremental-sync) | Delta syncing with `since: lastSync` and checkpoints |
| [webhook-payment](https://github.com/mcclowes/reqon/tree/main/examples/webhook-payment) | `wait` steps with webhook filtering |
| [durable-approval](https://github.com/mcclowes/reqon/tree/main/examples/durable-approval) | Resource-free `pause` with `resumeOn: webhook` and restart survival |
| [scheduled-reports](https://github.com/mcclowes/reqon/tree/main/examples/scheduled-reports) | `schedule: cron` with scheduling options |
| [circuit-breaker](https://github.com/mcclowes/reqon/tree/main/examples/circuit-breaker) | Circuit breaker and fallback sources |
| [database-sync](https://github.com/mcclowes/reqon/tree/main/examples/database-sync) | Multi-store operations with upsert and partial updates |
| [data-enrichment](https://github.com/mcclowes/reqon/tree/main/examples/data-enrichment) | `let` bindings, the spread operator, and computed fields |
| [postgrest-sync](https://github.com/mcclowes/reqon/tree/main/examples/postgrest-sync) | PostgreSQL via the `postgrest()` store |
| [crud-operations](https://github.com/mcclowes/reqon/tree/main/examples/crud-operations) | Full CRUD lifecycle with PUT, PATCH, and DELETE |
| [file-export](https://github.com/mcclowes/reqon/tree/main/examples/file-export) | Exports, reports, and backups with the `file()` store |
| [mock-server-demo](https://github.com/mcclowes/reqon/tree/main/examples/mock-server-demo) | Running a mission against a local mock server |
