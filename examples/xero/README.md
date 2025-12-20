# Xero Invoice Sync Example

Demonstrates a real-world sync pipeline with OAuth2 authentication, pagination, hydration, normalization, and comprehensive error handling.

## What it does

1. **FetchInvoiceList**: Fetches paginated invoice summaries with error handling
2. **HydrateInvoices**: Fetches full details for each invoice, handling individual failures
3. **RefreshToken**: OAuth token refresh (called via `jump` directive on auth errors)
4. **NormalizeInvoices**: Maps Xero schema to a vendor-agnostic `StandardInvoice` format

## Run

```bash
node dist/cli.js examples/xero/invoices.reqon --auth credentials.json --verbose
```

Requires a `credentials.json`:
```json
{
  "Xero": {
    "type": "oauth2",
    "accessToken": "your-xero-access-token"
  }
}
```

## Features demonstrated

### OAuth2 Authentication
```reqon
source Xero {
  auth: oauth2,
  base: "https://api.xero.com/api.xro/2.0"
}
```

### Pagination with Until Condition
```reqon
get "/Invoices" {
  paginate: offset(page, 100),
  until: length(response.Invoices) == 0
}
```

### Schema Overloading with Match Steps
Handle different API response types declaratively:
```reqon
match response {
  XeroInvoiceList -> { store response.Invoices -> cache },
  XeroRateLimitError -> retry { maxAttempts: 5, backoff: exponential },
  XeroUnauthorizedError -> jump RefreshToken then retry,
  _ -> abort "Unexpected response"
}
```

### Flow Control Directives

| Directive | Usage | Description |
|-----------|-------|-------------|
| `continue` | `Schema -> continue` | Proceed to next step |
| `skip` | `Schema -> skip` | Skip remaining steps in action |
| `abort` | `Schema -> abort "message"` | Halt mission with error |
| `retry` | `Schema -> retry { ... }` | Retry with backoff config |
| `queue` | `Schema -> queue target` | Send to dead-letter queue |
| `jump` | `Schema -> jump Action then retry` | Execute action, then continue |

### Partial Record Hydration
```reqon
store response.Invoices -> invoices_cache {
  key: .InvoiceID,
  partial: true  // Mark as needing hydration
}

for invoice in invoices_cache where ._partial == true {
  // Fetch full details
}
```

### Match Expressions for Field Mapping
```reqon
status: match .Status {
  "PAID" => "paid",
  "AUTHORISED" => "approved",
  "SUBMITTED" => "pending",
  _ => "unknown"
}
```
