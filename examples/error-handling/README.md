# Error Handling Example

Demonstrates comprehensive error handling with schema matching and all flow control directives.

## What it does

1. **FetchPendingPayments**: Fetches payments with retry and auth refresh
2. **CheckFraudRisk**: Checks each payment for fraud, routing high-risk to review queue
3. **ProcessPayments**: Captures approved payments with full error handling
4. **GenerateReport**: Creates a summary of processing results

## Run

```bash
node dist/cli.js examples/error-handling/payment-processor.reqon --auth credentials.json --verbose
```

## Flow Control Directives

This example demonstrates all six flow control directives:

### 1. `continue` - Proceed to next step
```reqon
match response {
  FraudWarning where .risk_level == "low" -> continue
}
```
When the condition matches, continue with the next steps in the action.

### 2. `skip` - Skip remaining steps in current iteration
```reqon
match response {
  _ -> skip  // Unknown response - skip this payment, move to next
}
```
Skips remaining steps for the current item in a `for` loop but continues with the next item.

### 3. `abort "message"` - Halt mission with error
```reqon
match response {
  ServerError -> abort "Payment gateway unavailable"
}
```
Immediately stops the entire mission and reports the error.

### 4. `retry { config }` - Retry with backoff
```reqon
match response {
  RateLimitError -> retry {
    maxAttempts: 5,
    backoff: exponential,    // or: linear, constant
    initialDelay: 5000,
    maxDelay: 120000
  }
}
```
Retries the current fetch with configurable backoff strategy.

### 5. `queue target` - Send to dead-letter queue
```reqon
match response {
  ServerError -> queue dead_letter_queue
}
```
Parks the current item for later processing or manual review.

### 6. `jump Action then retry` - Execute action, then continue
```reqon
match response {
  AuthenticationError -> jump RefreshAuth then retry
}
```
Jumps to another action (e.g., to refresh auth), then retries the original request.

## Schema Matching Patterns

### Simple Schema Match
```reqon
match response {
  PaymentSuccess -> { store response -> payments }
}
```

### Schema with Guard Clause
```reqon
match response {
  FraudWarning where .risk_level == "high" -> queue fraud_review
}
```

### Array Schema Match
```reqon
match response {
  [PaymentSuccess] -> { store response -> payments { key: .id } }
}
```

### Wildcard (Catch-All)
```reqon
match response {
  SuccessSchema -> continue,
  ErrorSchema -> abort "Error occurred",
  _ -> skip  // Handle any other response
}
```

## Error Handling Patterns

### 1. Retry with Auth Refresh
```reqon
AuthenticationError -> jump RefreshAuth then retry
```

### 2. Progressive Backoff
```reqon
RateLimitError -> retry {
  maxAttempts: 5,
  backoff: exponential,
  initialDelay: 1000,
  maxDelay: 60000
}
```

### 3. Dead Letter Queue for Failures
```reqon
ServerError -> queue dead_letter_queue
```

### 4. Conditional Processing
```reqon
match response {
  FraudWarning where .risk_level == "low" -> continue,
  FraudWarning where .risk_level == "medium" -> {
    store { ... } -> review_queue
  },
  FraudWarning where .risk_level == "high" -> {
    store { ... } -> fraud_queue
  }
}
```

## Features demonstrated

- All 6 flow control directives
- Schema matching with guard clauses
- Retry with exponential/linear/constant backoff
- Token refresh via `jump...then retry`
- Dead letter queue pattern
- Conditional routing based on response content
- Error logging and audit trails
