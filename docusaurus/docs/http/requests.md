---
sidebar_position: 1
---

# HTTP Requests

Reqon handles HTTP requests with built-in support for pagination, retries, rate limiting, and incremental sync.

## Request methods

```vague
// GET - Retrieve data
get "/users"

// POST - Create data
post "/users" { body: { name: "John" } }

// PUT - Replace data
put "/users/123" { body: { name: "Jane" } }

// PATCH - Partial update
patch "/users/123" { body: { email: "jane@example.com" } }

// DELETE - Remove data
delete "/users/123"
```

## Request options

A fetch step accepts only these options: `source`, `body`, `paginate`, `until`, `retry`, `since`, and `backfill`. There's no `params`, `headers`, `timeout`, or `method` option on a request.

### Query parameters

There's no `params` option. Put query parameters directly in the path string:

```vague
get "/users?limit=100&offset=0&status=active&sort=created_at&order=desc"
```

### Dynamic parameters

Build the path with an expression, for example with `concat`:

```vague
get concat("/users?status=active&limit=", pageSize)
```

### Request body

Send JSON body with POST/PUT/PATCH:

```vague
post "/users" {
  body: {
    name: "John Doe",
    email: "john@example.com",
    metadata: {
      source: "api",
      importedAt: now()
    }
  }
}
```

### Dynamic body

Build body from variables:

```vague
for user in usersToCreate {
  post "/users" {
    body: {
      name: user.name,
      email: user.email,
      role: user.role or "user"
    }
  }
}
```

### Custom headers

Per-request headers aren't supported on a fetch step. Declare headers on the source instead, where they apply to every request:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  headers: {
    "Accept": "application/json",
    "X-API-Version": "2.0"
  }
}
```

## Response handling

### Accessing response data

The `response` variable contains the parsed JSON:

```vague
action FetchUsers {
  get "/users"

  // Access response data
  for user in response.data {
    store user -> users { key: .id }
  }

  // Access metadata
  validate {
    assume response.total > 0
  }
}
```

### Response structure

```vague
// Common API response pattern
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "perPage": 20
  }
}

// Access in Reqon
for item in response.data { }
validate { assume response.meta.total > 0 }
```

## Working with multiple sources

### Default source

The first defined source is the default:

```vague
mission Example {
  source API { auth: bearer, base: "https://api.example.com" }

  action Fetch {
    get "/users"  // Uses API source
  }
}
```

### Named source

Specify the source explicitly with the `source` option:

```vague
mission MultiSource {
  source Primary { auth: bearer, base: "https://primary.api.com" }
  source Backup { auth: bearer, base: "https://backup.api.com" }

  action FetchFromBoth {
    get "/users" { source: Primary }
    store response -> primaryUsers { key: .id }

    get "/users" { source: Backup }
    store response -> backupUsers { key: .id }
  }
}
```

## Dynamic URLs

Build URLs dynamically:

```vague
action FetchDetails {
  for user in users {
    // String concatenation
    get concat("/users/", user.id)

    // Nested resources
    get concat("/users/", user.id, "/orders")

    // Complex paths
    get concat("/api/v", env("API_VERSION"), "/users/", user.id)
  }
}
```

## Request timeouts

There's no `timeout` option on a source or a standalone `timeout` key on a request. Set a per-attempt request timeout inside the `retry` block (milliseconds):

```vague
get "/slow-endpoint" {
  retry: {
    maxAttempts: 3,
    timeout: 120000  // Abort each attempt after 2 minutes
  }
}
```

## Error handling

Handle HTTP errors with match:

```vague
action SafeFetch {
  get "/users"

  match response {
    { error: _, code: 401 } -> jump RefreshAuth then retry,
    { error: _, code: 404 } -> skip,
    { error: _, code: 429 } -> retry { initialDelay: 60000 },
    { error: e } -> abort e,
    _ -> store response -> users { key: .id }
  }
}
```

## Request chaining

Chain requests with data from previous responses:

```vague
action FetchWithDetails {
  // First request
  get "/orders"

  for order in response.orders {
    // Use data from first request
    get concat("/customers/", order.customerId)

    map order -> EnrichedOrder {
      ...order,
      customer: response
    }

    store order -> enrichedOrders { key: .id }
  }
}
```

## Batching requests

For APIs that support batch operations:

```vague
action BatchFetch {
  // Collect IDs
  get "/items?status=pending"

  // Batch request
  post "/items/batch" {
    body: {
      ids: response.items.map(.id)
    }
  }

  store response -> batchResults
}
```

## Best practices

### Use descriptive error handling

```vague
match response {
  { error: _, code: 400 } -> abort "Invalid request data",
  { error: _, code: 401 } -> abort "Authentication failed",
  { error: _, code: 403 } -> abort "Permission denied",
  { error: _, code: 404 } -> abort "Resource not found",
  { error: _, code: 429 } -> retry { initialDelay: 60000 },
  { error: _, code: 500 } -> retry { maxAttempts: 3 },
  { error: e } -> abort e,
  _ -> continue
}
```

### Validate before processing

```vague
get "/data"

validate response {
  assume .data is array,
  assume length(.data) > 0
}

for item in response.data { }
```

### Log important requests

```vague
get "/important-operation"

match response {
  { success: true } -> {
    store { operation: "fetch", status: "success", timestamp: now() } -> logs
    continue
  },
  _ -> {
    store { operation: "fetch", status: "failed", response: response } -> logs
    abort "Operation failed"
  }
}
```
