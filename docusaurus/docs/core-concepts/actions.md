---
sidebar_position: 2
---

# Actions

An **Action** is a named sequence of steps that process data. Actions are the building blocks of your pipeline logic.

## Basic Structure

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

## Step Types

Actions can contain the following step types:

| Step | Description |
|------|-------------|
| `get`, `post`, `put`, `patch`, `delete` | HTTP requests |
| `call` | OAS operation call |
| `for...in...where` | Iteration with optional filtering |
| `map...->` | Data transformation |
| `validate` | Constraint checking |
| `store...->` | Data persistence |
| `match` | Pattern matching with flow control |

## HTTP Request Steps

Fetch data from APIs:

```vague
action FetchData {
  // Simple GET
  get "/users"

  // With query parameters
  get "/users" { params: { limit: 100, offset: 0 } }

  // With pagination
  get "/users" {
    paginate: offset(page, 100),
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

## Iteration Steps

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

## Transformation Steps

Transform data shapes:

```vague
action TransformData {
  get "/users"

  for user in response.users {
    map user -> StandardUser {
      id: .id,
      fullName: concat(.firstName, " ", .lastName),
      email: lowercase(.email),
      createdAt: parseDate(.created_at)
    }

    store user -> users { key: .id }
  }
}
```

See the [Vague documentation](https://github.com/mcclowes/vague) for expression syntax.

## Validation Steps

Check data constraints:

```vague
action ValidateData {
  get "/users"

  for user in response.users {
    validate user {
      assume .id is string,
      assume length(.name) > 0,
      assume .email contains "@",
      assume .age >= 18
    }

    store user -> users { key: .id }
  }
}
```

## Store Steps

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

## Pattern Matching Steps

Route data based on shape:

```vague
action HandleResponse {
  get "/users"

  match response {
    { error: e, code: 401 } -> jump RefreshToken then retry,
    { error: e, code: 429 } -> retry { maxAttempts: 5 },
    { error: e } -> abort "API error",
    { users: _ } -> continue,
    _ -> abort "Unexpected response"
  }
}
```

## Nested Actions

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

## Action Composition in Pipelines

Actions are composed in the `run` statement:

```vague
mission DataPipeline {
  action Fetch { /* ... */ }
  action Transform { /* ... */ }
  action Export { /* ... */ }

  // Sequential
  run Fetch then Transform then Export

  // Parallel groups
  run [FetchA, FetchB] then Merge then Export
}
```

## Variable Scope

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

## Best Practices

### Single Responsibility

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

### Handle Errors at Action Boundaries

```vague
action FetchWithErrorHandling {
  get "/users"

  match response {
    ErrorResponse -> queue failures { item: response },
    _ -> store response -> users { key: .id }
  }
}
```

### Use Descriptive Names

```vague
// Good
action FetchActiveCustomersWithOrders { }
action TransformToQuickBooksFormat { }
action ExportToDataWarehouse { }

// Avoid
action Step1 { }
action Process { }
```
