# Reqon Examples

This directory contains examples demonstrating Reqon's features for declarative data pipelines.

## Examples Overview

| Example | Description | Key Features |
|---------|-------------|--------------|
| [jsonplaceholder](./jsonplaceholder/) | Basic public API sync | `auth: none`, fetch, map, for loops |
| [petstore](./petstore/) | OpenAPI spec integration | OAS operationId, cursor pagination |
| [xero](./xero/) | OAuth2 invoice sync | OAuth2, hydration, **match steps**, **flow control** |
| [github-sync](./github-sync/) | Multi-file mission | **Folder structure**, **parallel execution**, schema matching |
| [error-handling](./error-handling/) | Comprehensive error handling | **All flow control directives**, dead letter queues |
| [temporal-comparison](./temporal-comparison/) | E-commerce reconciliation | Multi-source, **parallel execution**, rate limiting |

## Feature Index

### Multi-File Missions
Organize large missions into folders with separate action files:
```
github-sync/
├── mission.reqon       # Sources, stores, schemas, pipeline
├── fetch-issues.reqon  # Action file
├── fetch-prs.reqon     # Action file
└── normalize.reqon     # Action file
```
See: [github-sync](./github-sync/)

### Parallel Execution
Run multiple actions concurrently:
```reqon
run [FetchOrders, FetchPayments, FetchShipments] then Reconcile
```
See: [github-sync](./github-sync/), [temporal-comparison](./temporal-comparison/)

### Schema Overloading with Match Steps
Handle different API response types declaratively:
```reqon
match response {
  SuccessSchema -> { store response -> cache },
  RateLimitError -> retry { maxAttempts: 5 },
  AuthError -> jump RefreshToken then retry,
  _ -> abort "Unexpected response"
}
```
See: [xero](./xero/), [error-handling](./error-handling/)

### Flow Control Directives
Six directives for controlling execution flow:

| Directive | Description | Example |
|-----------|-------------|---------|
| `continue` | Proceed to next step | `Schema -> continue` |
| `skip` | Skip remaining steps | `Schema -> skip` |
| `abort` | Halt mission | `Schema -> abort "Error"` |
| `retry` | Retry with backoff | `Schema -> retry { maxAttempts: 5 }` |
| `queue` | Send to dead letter queue | `Schema -> queue dlq` |
| `jump` | Execute action, then continue | `Schema -> jump Refresh then retry` |

See: [error-handling](./error-handling/)

### Authentication Types
```reqon
source API { auth: none }           # Public API
source API { auth: bearer }         # Bearer token
source API { auth: oauth2 }         # OAuth2
source API { auth: basic }          # Basic auth
source API { auth: api_key }        # API key
```

### Pagination Strategies
```reqon
paginate: offset(page, 100)                    # Offset pagination
paginate: page(page, 100)                      # Page number pagination
paginate: cursor(cursor, 100, "nextCursor")   # Cursor pagination
```

## Running Examples

```bash
# Build first
npm run build

# Run any example
node dist/cli.js examples/<example>/<file>.reqon --verbose

# Run multi-file mission (folder)
node dist/cli.js examples/github-sync --verbose

# Dry run (no actual API calls)
node dist/cli.js examples/xero/invoices.reqon --dry-run

# With credentials
node dist/cli.js examples/xero/invoices.reqon --auth credentials.json
```

## Credentials Format

Create a `credentials.json` file:
```json
{
  "SourceName": {
    "type": "bearer",
    "token": "your-token"
  },
  "OAuthSource": {
    "type": "oauth2",
    "accessToken": "your-access-token",
    "refreshToken": "your-refresh-token"
  }
}
```
