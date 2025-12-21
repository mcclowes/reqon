---
sidebar_position: 1
---

# HTTP Requests

Reqon provides powerful HTTP request handling with built-in support for pagination, retries, rate limiting, and more.

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

### Query parameters

Add query parameters to requests:

```vague
get "/users" {
  params: {
    limit: 100,
    offset: 0,
    status: "active",
    sort: "created_at",
    order: "desc"
  }
}
```

Generates: `GET /users?limit=100&offset=0&status=active&sort=created_at&order=desc`

### Dynamic parameters

Use expressions in parameters:

```vague
get "/users" {
  params: {
    since: formatDate(lastSync, "YYYY-MM-DD"),
    limit: env("PAGE_SIZE") or 100
  }
}
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

Override or add headers:

```vague
get "/data" {
  headers: {
    "Accept": "application/json",
    "X-API-Version": "2.0",
    "X-Request-ID": uuid()
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

Specify source explicitly:

```vague
mission MultiSource {
  source Primary { auth: bearer, base: "https://primary.api.com" }
  source Backup { auth: bearer, base: "https://backup.api.com" }

  action FetchFromBoth {
    get Primary "/users"
    store response -> primaryUsers { key: .id }

    get Backup "/users"
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

Configure at source level:

```vague
source SlowAPI {
  auth: bearer,
  base: "https://slow.api.com",
  timeout: 60000  // 60 seconds
}
```

Or per-request (future feature):

```vague
get "/slow-endpoint" {
  timeout: 120000  // 2 minutes
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
    { error: _, code: 429 } -> retry { delay: 60000 },
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
  get "/items" { params: { status: "pending" } }

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
  { error: _, code: 429 } -> retry { delay: 60000 },
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
