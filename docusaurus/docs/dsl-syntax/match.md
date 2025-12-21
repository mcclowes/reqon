---
sidebar_position: 5
---

# Match (Pattern Matching)

Match steps route data based on its structure. They're essential for error handling, conditional processing, and flow control.

## Basic Syntax

```reqon
match target {
  Pattern1 -> action1,
  Pattern2 -> action2,
  _ -> defaultAction
}
```

## Schema Matching

Match against defined schemas:

```reqon
schema SuccessResponse {
  data: any,
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
    ErrorResponse -> abort response.error,
    _ -> abort "Unknown response format"
  }
}
```

## Object Pattern Matching

Match based on object structure:

```reqon
match response {
  { data: _, success: true } -> continue,
  { error: e, code: 401 } -> jump RefreshAuth then retry,
  { error: e, code: 429 } -> retry { delay: 60000 },
  { error: e } -> abort e,
  _ -> abort "Unexpected response"
}
```

### Binding Variables

Capture values from patterns:

```reqon
match response {
  { error: errorMsg, code: errorCode } -> {
    store { message: errorMsg, code: errorCode } -> errors
    abort errorMsg
  },
  _ -> continue
}
```

## Conditional Matching

Add conditions with `where`:

```reqon
match order {
  { status: "pending" } where .total > 1000 -> {
    // High-value pending order
    get concat("/orders/", order.id, "/flag")
  },
  { status: "pending" } -> continue,
  { status: "completed" } -> skip,
  _ -> continue
}
```

## Flow Control Directives

Match arms can use these directives:

| Directive | Description |
|-----------|-------------|
| `continue` | Proceed to next step |
| `skip` | Skip remaining steps (in loop) |
| `abort` | Halt mission with error |
| `retry` | Retry with backoff |
| `queue` | Send to dead letter queue |
| `jump...then` | Execute action, then continue |

### Continue

Proceed to the next step:

```reqon
match response {
  { data: _ } -> continue,
  _ -> abort "No data"
}
// Next step executes
```

### Skip

Skip remaining steps in current loop iteration:

```reqon
for item in items {
  match item {
    { status: "inactive" } -> skip,
    _ -> continue
  }
  // This only runs for non-inactive items
  store item -> activeItems { key: .id }
}
```

### Abort

Stop mission execution:

```reqon
match response {
  { error: msg } -> abort msg,
  { error: _ } -> abort "Unknown error",
  _ -> continue
}
```

### Retry

Retry the previous fetch:

```reqon
match response {
  { error: _, code: 429 } -> retry {
    maxAttempts: 5,
    backoff: exponential,
    initialDelay: 1000,
    maxDelay: 60000
  },
  { error: _ } -> abort "API error",
  _ -> continue
}
```

### Queue

Send to dead letter queue:

```reqon
match response {
  { error: e } -> queue dlq {
    item: {
      originalRequest: request,
      error: e,
      timestamp: now()
    }
  },
  _ -> continue
}
```

### Jump

Execute another action:

```reqon
match response {
  { error: _, code: 401 } -> jump RefreshToken then retry,
  _ -> continue
}

action RefreshToken {
  post "/auth/refresh" {
    body: { refreshToken: env("REFRESH_TOKEN") }
  }
}
```

## Matching Arrays

```reqon
match response.items {
  [] -> abort "No items found",
  [single] -> store single -> item,
  _ -> store response.items -> items { key: .id }
}
```

## Matching with Nested Steps

Execute multiple steps in a match arm:

```reqon
match response {
  { status: "error" } -> {
    // Multiple steps
    store response -> errors
    abort response.message
  },
  { data: items } -> {
    for item in items {
      store item -> processed { key: .id }
    }
    continue
  },
  _ -> continue
}
```

## Type Matching

```reqon
match value {
  v where v is string -> { /* handle string */ },
  v where v is number -> { /* handle number */ },
  v where v is array -> { /* handle array */ },
  v where v is null -> { /* handle null */ },
  _ -> abort "Unexpected type"
}
```

## HTTP Status Code Handling

```reqon
schema Success { data: any }
schema NotFound { error: string }
schema RateLimit { error: string, retryAfter: number }
schema AuthError { error: string, code: number }

action FetchWithErrorHandling {
  get "/resource"

  match response {
    Success -> store response.data -> data { key: .id },
    RateLimit -> retry { delay: response.retryAfter * 1000 },
    AuthError where .code == 401 -> jump RefreshAuth then retry,
    NotFound -> skip,
    _ -> abort "Unexpected response"
  }
}
```

## Pattern Matching Order

Patterns are matched in order; first match wins:

```reqon
match value {
  // More specific patterns first
  { status: "urgent", priority: 1 } -> handleUrgent,
  { status: "urgent" } -> handleHighPriority,
  { priority: 1 } -> handlePriority,
  { status: _ } -> handleNormal,
  _ -> handleDefault
}
```

## Exhaustive Matching

Always include a catch-all pattern:

```reqon
// Good: handles all cases
match response {
  { data: _ } -> continue,
  { error: _ } -> abort "Error",
  _ -> abort "Unexpected format"  // Catch-all
}

// Risky: might miss cases
match response {
  { data: _ } -> continue,
  { error: _ } -> abort "Error"
  // What if neither matches?
}
```

## Complete Example

```reqon
mission RobustDataSync {
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
          match item {
            { status: "invalid" } -> {
              store item -> errors { key: item.id }
              skip
            },
            { status: "pending" } where item.priority == "high" -> {
              // Process high priority immediately
              get concat("/items/", item.id, "/process")
              continue
            },
            _ -> continue
          }
          store item -> data { key: .id }
        }
      },

      // Rate limited
      RateLimitError -> retry {
        delay: response.retryAfter * 1000,
        maxAttempts: 5
      },

      // Auth expired
      AuthError where .code == 401 -> jump RefreshToken then retry,

      // Validation error
      ValidationError -> {
        store {
          type: "validation",
          message: response.error,
          details: response.details
        } -> errors
        abort response.error
      },

      // Unknown error
      _ -> queue dlq {
        item: {
          response: response,
          timestamp: now()
        }
      }
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

For more pattern matching features, see the [Vague documentation](https://github.com/mcclowes/vague).
