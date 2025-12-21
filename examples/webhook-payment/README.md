# Webhook Payment Processing Example

Demonstrates Reqon's webhook handling capabilities for async payment flows.

## Key Features

| Feature | Description |
|---------|-------------|
| `wait` step | Pause execution until webhook arrives |
| `timeout` | Maximum wait time in milliseconds |
| `expectedEvents` | Event types that complete the wait |
| `eventFilter` | Expression to match webhook to context |
| `retryOnTimeout` | Whether to retry on timeout |
| `storage` | Store for audit logging |

## How Wait Steps Work

```vague
wait {
  timeout: 300000,                    // 5 minutes max
  path: "/webhooks/payment",          // Webhook endpoint
  expectedEvents: ["payment.success", "payment.failed"],
  eventFilter: .payment_id == local_payment_id,
  retryOnTimeout: false,
  storage: webhook_events
}
```

1. **Execution pauses** at the `wait` step
2. **Webhook receiver** listens on the specified path
3. **Event matching** filters by type and custom expression
4. **On match**: `webhook` variable is populated, execution continues
5. **On timeout**: `webhook` is null or timeout error

## Webhook Variable

After a `wait` step, the matched webhook is available as `webhook`:

```vague
match webhook {
  _ where .type == "payment.success" -> {
    // Handle success
  },
  _ where .type == "payment.failed" -> {
    // Handle failure
  },
  _ -> {
    // Timeout or unexpected
  }
}
```

## Usage

```bash
# Start the mission (will wait for webhooks)
node dist/cli.js examples/webhook-payment/payment.vague --verbose

# The CLI will display the webhook endpoint URL
# Configure your payment provider to send webhooks to that URL
```

## Event Filtering

The `eventFilter` expression runs against each incoming webhook:

```vague
// Match by payment ID in webhook data
eventFilter: .data.object.id == payment.payment_id

// Match by metadata
eventFilter: .data.object.metadata.order_id == order.id

// Multiple conditions
eventFilter: .type startsWith "payment" and .data.amount > 0
```

## Non-Blocking Webhook Checks

Use `timeout: 0` for non-blocking checks:

```vague
wait {
  timeout: 0,  // Check for existing webhooks, don't wait
  ...
}
```

## Best Practices

1. **Set appropriate timeouts**: Match expected payment completion time
2. **Store all webhooks**: Use `storage` for audit trails
3. **Handle timeouts gracefully**: Not all payments complete immediately
4. **Use idempotent handlers**: Webhooks may be delivered multiple times
