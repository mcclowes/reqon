---
sidebar_position: 1
---

# Fetch steps

Fetch steps make HTTP requests to APIs. They're the primary way to retrieve data in Reqon.

## HTTP methods

```vague
// GET request
get "/users"

// POST request
post "/users" { body: { name: "John" } }

// PUT request
put "/users/123" { body: { name: "Jane" } }

// PATCH request
patch "/users/123" { body: { email: "jane@example.com" } }

// DELETE request
delete "/users/123"
```

## Request options

A fetch option block accepts only these keys: `source`, `body`, `paginate`, `until`, `retry`, `since`, and `backfill`. Anything else is a parse error.

### Query parameters

There's no `params:` option. Put query parameters directly in the path string:

```vague
get "/users?limit=100&offset=0&status=active"
```

### Request body

```vague
post "/users" {
  body: {
    name: "John Doe",
    email: "john@example.com",
    roles: ["user", "admin"]
  }
}
```

### Headers

You can't set per-request headers on a fetch step. Headers are declared once on the source, in its `headers` block, and apply to every request through that source:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  headers: {
    "Accept": "application/json",
    "X-Custom-Header": "value"
  }
}
```

## Pagination

### Offset-based

```vague
get "/users" {
  paginate: offset(page, 100),
  until: length(response) == 0
}
```

Parameters:
- `page` - Query parameter name for offset value
- `100` - Page size

### Page number-based

```vague
get "/users" {
  paginate: page(pageNum, 50),
  until: response.meta.hasNext == false
}
```

Parameters:
- `pageNum` - Query parameter name for page number
- `50` - Page size

### Cursor-based

```vague
get "/users" {
  paginate: cursor(cursor, 100, "meta.nextCursor"),
  until: response.meta.nextCursor == null
}
```

Parameters:
- `cursor` - Query parameter name
- `100` - Page size
- `"meta.nextCursor"` - Path to next cursor in response

See [Pagination](../http/pagination) for detailed documentation.

## Termination conditions

The `until` option specifies when to stop paginating:

```vague
// Stop when empty response
get "/users" {
  paginate: offset(page, 100),
  until: length(response) == 0
}

// Stop when no more pages
get "/users" {
  paginate: page(p, 50),
  until: response.pagination.hasNext == false
}

// Stop when cursor is null
get "/users" {
  paginate: cursor(c, 100, "nextCursor"),
  until: response.nextCursor == null
}

// Stop after N items
get "/users" {
  paginate: offset(page, 100),
  until: length(response) == 0 or page > 10
}
```

## Retry configuration

```vague
get "/users" {
  retry: {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 30000
  }
}
```

Options:
- `maxAttempts` - Maximum retry attempts (default 3)
- `backoff` - Strategy: `exponential`, `linear`, or `constant` (default `exponential`)
- `initialDelay` - First retry delay in milliseconds (default 1000)
- `maxDelay` - Maximum delay between retries in milliseconds
- `timeout` - Per-request timeout in milliseconds

See [Retry Strategies](../http/retry) for details.

## Incremental sync

Fetch only changes since last run:

```vague
get "/users" {
  since: lastSync
}
```

This automatically adds a timestamp parameter to the request.

See [Incremental Sync](../http/incremental-sync) for details.

## Response handling

The `response` variable is automatically set after each fetch:

```vague
action FetchUsers {
  get "/users"

  // response contains the parsed JSON body
  for user in response.data {
    store user -> users { key: .id }
  }
}
```

### Response structure

```vague
action InspectResponse {
  get "/users"

  // Access body data
  store response.users -> users { key: .id }

  // Check response metadata
  validate response {
    assume response.total > 0
  }
}
```

## Named source requests

When you have multiple sources, use the `source` option to pick one. The first source defined is the default:

```vague
mission MultiSource {
  source Primary { auth: bearer, base: "https://primary.api.com" }
  source Secondary { auth: bearer, base: "https://secondary.api.com" }

  action FetchBoth {
    // Default source (first defined)
    get "/users"

    // Explicit source
    get "/backup-users" { source: Secondary }
  }
}
```

## Dynamic paths

Interpolate values into a path with `{...}`. The names resolve against the current loop variable and action variables:

```vague
action FetchUserOrders {
  for user in users {
    get "/users/{user.id}/orders"
    store response -> orders { key: .id }
  }
}
```

You can also build the path with the `+` operator, which concatenates strings:

```vague
get "/users/" + user.id + "/orders"
```

## OpenAPI operation calls

When using OAS sources, use `call` syntax. The path and its parameters come from the spec and from interpolated context, so a `call` takes only the standard fetch options (no `params`):

```vague
source Petstore from "./petstore.yaml" { auth: bearer }

action FetchPets {
  call Petstore.listPets

  call Petstore.getPetById
}
```

See [OpenAPI Integration](../category/openapi-integration) for details.

## Complete example

```vague
mission DataSync {
  source API {
    auth: bearer,
    base: "https://api.example.com/v1"
  }

  store users: file("users")

  action FetchAllUsers {
    get "/users?include=profile" {
      paginate: offset(offset, 100),
      until: length(response.users) == 0,
      retry: {
        maxAttempts: 3,
        backoff: exponential,
        initialDelay: 1000
      },
      since: lastSync
    }

    for user in response.users {
      validate user {
        assume .id is string,
        assume .email is string
      }
      store user -> users { key: .id, upsert: true }
    }
  }

  run FetchAllUsers
}
```
