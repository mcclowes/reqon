# Xero Invoice Sync Example

Demonstrates a real-world sync pipeline with OAuth2 authentication, pagination, hydration, and normalization.

## What it does

1. **FetchInvoiceList**: Fetches paginated invoice summaries (shallow data)
2. **HydrateInvoices**: Fetches full details for each invoice marked as partial
3. **NormalizeInvoices**: Maps Xero schema to a vendor-agnostic `StandardInvoice` format

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

- `auth: oauth2` for OAuth2 authentication
- Offset-based pagination with `until` condition
- `partial: true` to mark items needing hydration
- `where` clause filtering (`._partial == true`)
- Path interpolation (`/Invoices/{invoice.InvoiceID}`)
- `upsert: true` for updating existing records
- `match` expressions for status mapping
- Multi-action pipelines with `run...then`
