---
sidebar_position: 8
---

# Wait Steps (Webhooks)

Wait steps pause execution until an external webhook callback is received. This enables async workflows where you need to wait for third-party systems to notify you of events.

## Basic Usage

```vague
action ProcessPayment {
  // Start a payment with a provider
  post "/payments" {
    body: {
      amount: 100,
      currency: "USD",
      callback_url: response.webhookUrl
    }
  }

  // Wait for the payment provider to call back
  wait {
    path: "/webhooks/payment",
    timeout: 60000
  }

  // response now contains the webhook payload
  store response -> payments { key: .paymentId }
}
```

## Options

### Timeout

Maximum time to wait for the webhook in milliseconds. Default: 300000 (5 minutes).

```vague
wait {
  path: "/webhooks/callback",
  timeout: 120000  // 2 minutes
}
```

### Path

The webhook endpoint path. This is appended to the webhook server's base URL.

```vague
wait {
  path: "/webhooks/orders/completed"
}
```

### Expected Events

Wait for multiple webhook events before continuing. Default: 1.

```vague
wait {
  path: "/webhooks/batch",
  expectedEvents: 5,
  timeout: 300000
}

// response is an array when expectedEvents > 1
for event in response {
  store event -> events { key: .id }
}
```

### Event Filter

Filter incoming webhooks using an expression. Only matching events are collected.

```vague
wait {
  path: "/webhooks/orders",
  eventFilter: .status == "completed" and .amount > 100,
  timeout: 60000
}
```

### Storage

Automatically store webhook payloads as they arrive:

```vague
wait {
  path: "/webhooks/events",
  expectedEvents: 10,
  storage: {
    target: events,
    key: .eventId
  }
}
```

### Retry on Timeout

Retry the entire action if the webhook times out:

```vague
wait {
  path: "/webhooks/callback",
  timeout: 30000,
  retryOnTimeout: {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000
  }
}
```

## Webhook URL in Response

After a `wait` step is registered, `response` contains the webhook URL info:

```vague
action CreateOrderWithCallback {
  // Register webhook first
  wait {
    path: "/webhooks/order-complete"
  }

  // response.webhookUrl contains the full callback URL
  post "/orders" {
    body: {
      items: cart.items,
      callback: response.webhookUrl
    }
  }

  // Now wait for the actual callback
  // (the wait step blocks until a webhook arrives)
}
```

## CLI Configuration

Enable the webhook server with CLI flags:

```bash
# Enable webhook server on default port 3000
reqon mission.vague --webhook

# Custom port
reqon mission.vague --webhook --webhook-port 8080

# Custom base URL (for production/tunnels)
reqon mission.vague --webhook --webhook-url https://my-server.ngrok.io
```

## Complete Example

```vague
mission PaymentProcessing {
  source PaymentAPI {
    auth: bearer,
    base: "https://payments.example.com/v1"
  }

  store payments: file("payments")
  store webhookEvents: file("webhook-events")

  action ProcessPayment {
    // Create a payment intent
    post "/payment-intents" {
      body: {
        amount: order.amount,
        currency: "USD"
      }
    }

    let paymentId = response.id

    // Wait for payment confirmation via webhook
    wait {
      path: concat("/webhooks/payments/", paymentId),
      timeout: 300000,
      eventFilter: .type == "payment.completed" or .type == "payment.failed",
      storage: {
        target: webhookEvents,
        key: .id
      },
      retryOnTimeout: {
        maxAttempts: 2,
        backoff: exponential,
        initialDelay: 5000
      }
    }

    // Handle the webhook response
    match response {
      PaymentSuccess -> {
        store { id: paymentId, status: "completed", ...response } -> payments { key: .id }
      }
      PaymentFailed -> {
        store { id: paymentId, status: "failed", error: response.error } -> payments { key: .id }
        abort "Payment failed"
      }
    }
  }

  run ProcessPayment
}
```

## Use Cases

### Async API Callbacks

Many APIs use webhooks for async operations:

- Payment processing (Stripe, PayPal)
- Document generation
- Long-running computations
- Third-party integrations

### Event-Driven Pipelines

Wait for external events to trigger pipeline stages:

```vague
action WaitForApproval {
  post "/approvals/request" {
    body: { documentId: doc.id }
  }

  wait {
    path: "/webhooks/approvals",
    eventFilter: .documentId == doc.id,
    timeout: 86400000  // 24 hours
  }

  validate response {
    assume .approved == true
  }
}
```

### Batch Processing

Collect multiple webhook events before processing:

```vague
action CollectBatchEvents {
  wait {
    path: "/webhooks/batch-complete",
    expectedEvents: 100,
    timeout: 600000,
    storage: {
      target: batchEvents,
      key: .eventId
    }
  }

  // Process all collected events
  for event in response {
    map event -> ProcessedEvent {
      id: .eventId,
      data: .payload,
      processedAt: now()
    }
    store event -> processedEvents { key: .id }
  }
}
```

## Notes

- The webhook server must be running (`--webhook` flag) for wait steps to work
- In production, use a public URL (`--webhook-url`) or a tunnel service like ngrok
- Webhook events are stored in memory during execution; use `storage` for persistence
- If a wait times out and no `retryOnTimeout` is configured, execution fails
