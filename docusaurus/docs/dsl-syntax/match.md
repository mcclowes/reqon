---
sidebar_position: 5
---

# Match (schema matching)

Match steps route data based on which schema it matches. They're used for error handling, conditional processing, and flow control.

## Basic syntax

```vague
match target {
  SchemaA -> ...,
  SchemaB -> ...,
  _ -> ...
}
```

Each arm's left side is one of:

- a schema name, which matches when the value fits that schema's shape,
- a schema name with a guard, `SchemaName where <condition>`, or
- `_`, the wildcard that always matches.

Arms are tried in order, and the first match wins. If nothing matches, the step throws a `NoMatchError`, so include a `_` arm to handle the rest.

The right side of an arm is one of:

- a flow directive (`continue`, `skip`, `abort`, `retry`, `queue`, `jump`),
- a single step, or
- a `{ ... }` block of steps.

There are no object, array, literal, or binding patterns, and arms use `->`, not `=>`.

## Schema matching

Match against defined schemas:

```vague
schema SuccessResponse {
  data: array,
  status: string
}

schema ErrorResponse {
  error: string,
  code: number
}

action HandleResponse {
  get "/data"

  match response {
    SuccessResponse -> store response.data -> data { key: .id },
    ErrorResponse -> abort "Request failed",
    _ -> abort "Unknown response format"
  }
}
```

## Conditional matching

Add a guard with `where` to narrow an arm further. The guard is evaluated against the matched value:

```vague
schema Order {
  status: string,
  total: number
}

match order {
  Order where order.total > 1000 -> {
    // High-value order
    get "/orders/{order.id}/flag"
  },
  Order -> continue,
  _ -> continue
}
```

You can guard the wildcard too, which is handy for value-based routing:

```vague
match response {
  _ where response.code == 429 -> retry,
  _ where not (response.error == null) -> abort "API error",
  _ -> continue
}
```

## Flow control directives

Match arms can use these directives:

| Directive | Description |
|-----------|-------------|
| `continue` | Proceed to the next step |
| `skip` | Skip the rest of the current loop iteration |
| `abort` | Halt the mission with an error |
| `retry` | Retry with backoff |
| `queue` | Send the value to a queue target |
| `jump` | Run another action, then optionally retry or continue |

### Continue

Proceed to the next step:

```vague
match response {
  SuccessResponse -> continue,
  _ -> abort "No data"
}
// Next step executes
```

### Skip

Skip the remaining steps in the current loop iteration:

```vague
for item in items {
  match item {
    InactiveItem -> skip,
    _ -> continue
  }
  // This only runs for items that aren't inactive
  store item -> activeItems { key: .id }
}
```

### Abort

Stop mission execution. `abort` takes an optional string message (a literal, not an expression):

```vague
match response {
  ErrorResponse -> abort "Request returned an error",
  _ -> continue
}
```

### Retry

Retry the previous fetch. A bare `retry` uses the default backoff; an optional block sets the retry config:

```vague
match response {
  RateLimitError -> retry {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 60000
  },
  ErrorResponse -> abort "API error",
  _ -> continue
}
```

### Queue

Send the matched value to a queue target:

```vague
match response {
  ErrorResponse -> queue dlq,
  _ -> continue
}
```

### Jump

Run another action. `then retry` re-runs the current step afterward; `then continue` moves on:

```vague
match response {
  AuthError -> jump RefreshToken then retry,
  _ -> continue
}

action RefreshToken {
  post "/auth/refresh" {
    body: { refreshToken: env("REFRESH_TOKEN") }
  }
}
```

## Matching with nested steps

Run several steps in a match arm by wrapping them in a block:

```vague
match response {
  ErrorResponse -> {
    store response -> errors { key: .id }
    abort "Request failed"
  },
  SuccessResponse -> {
    for item in response.data {
      store item -> processed { key: .id }
    }
    continue
  },
  _ -> continue
}
```

## Type matching

Use a guard with `is` to route on the runtime type of a value:

```vague
match value {
  _ where value is string -> continue,
  _ where value is number -> continue,
  _ where value is array -> continue,
  _ where value is null -> skip,
  _ -> abort "Unexpected type"
}
```

## Exhaustive matching

Always include a `_` arm. Without one, a value that matches no schema throws a `NoMatchError`:

```vague
// Good: handles everything
match response {
  SuccessResponse -> continue,
  ErrorResponse -> abort "Error",
  _ -> abort "Unexpected format"
}
```

## Complete example

```vague
mission DataSync {
  source API { auth: oauth2, base: "https://api.example.com" }

  store data: file("data")
  store errors: file("errors")
  store dlq: file("dead-letter")

  schema SuccessResponse {
    data: array,
    pagination: object?
  }

  schema ValidationError {
    error: string,
    code: number,
    details: array?
  }

  schema RateLimitError {
    error: string,
    retryAfter: number
  }

  schema AuthError {
    error: string,
    code: number
  }

  action FetchData {
    get "/data" {
      paginate: offset(page, 100),
      until: length(response.data) == 0
    }

    match response {
      // Success case
      SuccessResponse -> {
        for item in response.data {
          store item -> data { key: .id }
        }
      },

      // Rate limited
      RateLimitError -> retry {
        maxAttempts: 5,
        backoff: exponential,
        initialDelay: 1000
      },

      // Auth expired
      AuthError -> jump RefreshToken then retry,

      // Validation error - route to the errors store
      ValidationError -> {
        store response -> errors { key: .id }
      },

      // Unknown error
      _ -> queue dlq
    }
  }

  action RefreshToken {
    post "/auth/refresh" {
      body: { refreshToken: env("REFRESH_TOKEN") }
    }
  }

  run FetchData
}
```

For more on schemas and expression syntax, see the [Vague documentation](https://github.com/mcclowes/vague).
