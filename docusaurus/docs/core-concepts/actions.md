---
sidebar_position: 2
---

# Actions

An **Action** is a named sequence of steps that process data. Actions are the building blocks of your pipeline logic.

## Basic structure

```vague
action ActionName {
  // Step 1
  get "/endpoint"

  // Step 2
  for item in response {
    // Nested steps
  }

  // Step 3
  store response -> storeName { key: .id }
}
```

## Step types

Actions can contain the following step types:

| Step | Description |
|------|-------------|
| `get`, `post`, `put`, `patch`, `delete` | HTTP requests |
| `call` | OAS operation call |
| `for...in...where` | Iteration with optional filtering |
| `map...->` | Data transformation |
| `apply...to` | Apply a named transform |
| `validate` | Constraint checking |
| `store...->` | Data persistence |
| `match` | Pattern matching with flow control |
| `let` | Bind a variable |
| `wait` | Wait for a webhook or callback |
| `pause` | Resource-free long pause |

## HTTP request steps

Fetch data from APIs:

```vague
action FetchData {
  // Simple GET
  get "/users"

  // Query parameters go in the path string
  get "/users?limit=100&offset=0"

  // With pagination
  get "/users" {
    paginate: page(page, 100),
    until: length(response.users) == 0
  }

  // POST with body
  post "/users" {
    body: {
      name: "John",
      email: "john@example.com"
    }
  }
}
```

## Iteration steps

Process collections:

```vague
action ProcessUsers {
  get "/users"

  // Iterate all items
  for user in response.users {
    // Process each user
  }

  // With filtering
  for user in response.users where .status == "active" {
    // Process only active users
  }
}
```

## Transformation steps

Transform data shapes:

```vague
action TransformData {
  get "/users"

  for user in response.users {
    map user -> StandardUser {
      id: .id,
      fullName: .firstName + " " + .lastName,
      email: .email,
      createdAt: .created_at
    }

    store user -> users { key: .id }
  }
}
```

Each field's right-hand side is an expression. Built-in functions include `length`, `sum`, `count`, `first`, `last`, `round`, `floor`, `ceil`, `now`, and `env`; `+` concatenates strings. See the [Vague documentation](https://github.com/mcclowes/vague) for the full expression syntax.

## Validation steps

Check data constraints:

```vague
action ValidateData {
  get "/users"

  for user in response.users {
    validate user {
      assume .id is string,
      assume length(.name) > 0,
      assume .email is string,
      assume .age >= 18
    }

    store user -> users { key: .id }
  }
}
```

Each `assume` takes a single condition expression. A failed assumption throws a `ValidationError` and aborts the mission, so validation is a hard gate, not a warning.

## Store steps

Persist data:

```vague
action SaveData {
  get "/users"

  // Store entire response
  store response -> allData

  // Store with key
  store response.users -> users { key: .id }

  // Upsert mode
  store response.users -> users { key: .id, upsert: true }

  // Partial update
  store response.users -> users { key: .id, partial: true }
}
```

## Pattern matching steps

Match arms route on schema name, with an optional `where` guard or a `_` wildcard. There are no object, array, or literal patterns. The matched schemas are defined at the mission level:

```vague
action HandleResponse {
  get "/users"

  match response {
    AuthError where .code == 401 -> jump RefreshToken then retry,
    RateLimitError where .code == 429 -> retry { maxAttempts: 5 },
    ErrorResponse -> abort "API error",
    UsersResponse -> continue,
    _ -> abort "Unexpected response"
  }
}
```

Arm right-hand sides are a flow directive (`continue`, `skip`, `abort`, `retry`, `queue`, `jump`), a single step, or a `{ ... }` block of steps. `abort` takes an optional string literal only.

## Nested actions

Actions can reference other actions via `jump`:

```vague
action Main {
  get "/data"

  match response {
    AuthError -> jump RefreshAuth then retry,
    _ -> continue
  }
}

action RefreshAuth {
  post "/auth/refresh" { body: { token: env("REFRESH_TOKEN") } }
  // Token is automatically used for subsequent requests
}
```

## Action composition in pipelines

Actions are composed in the `run` statement:

```vague
mission DataPipeline {
  action Fetch {
    // ...
  }
  action Transform {
    // ...
  }
  action Export {
    // ...
  }

  // Sequential
  run Fetch then Transform then Export

  // Parallel groups
  run [FetchA, FetchB] then Merge then Export
}
```

## Variable scope

Variables are scoped to their action and nested contexts:

```vague
action ProcessData {
  get "/users"  // response is set

  for user in response.users {
    // user is available here
    // response is still available

    map user -> processed {
      // user and response available
    }
    // processed is available
  }

  // user is no longer available here
  // response is still available
}
```

## Best practices

### Single responsibility

Each action should do one thing well:

```vague
// Good: focused actions
action FetchUsers {
  get "/users"
  store response -> rawUsers
}

action TransformUsers {
  for user in rawUsers {
    map user -> StandardUser { /* ... */ }
    store user -> users { key: .id }
  }
}

// Avoid: doing too much
action DoEverything {
  get "/users"
  get "/orders"
  // transform both
  // export to multiple places
}
```

### Handle errors at action boundaries

```vague
action FetchWithErrorHandling {
  get "/users"

  match response {
    ErrorResponse -> queue failures,
    _ -> store response -> users { key: .id }
  }
}
```

### Use descriptive names

```vague
// Good
action FetchActiveCustomersWithOrders { }
action TransformToQuickBooksFormat { }
action ExportToDataWarehouse { }

// Avoid
action Step1 { }
action Process { }
```
