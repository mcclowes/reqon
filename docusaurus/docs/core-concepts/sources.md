---
sidebar_position: 3
---

# Sources

A **Source** defines an API endpoint that your mission connects to. Sources configure authentication, base URLs, rate limiting, and other HTTP client options.

## Basic Syntax

```vague
source SourceName {
  auth: authType,
  base: "https://api.example.com"
}
```

## Authentication Types

| Type | Description |
|------|-------------|
| `none` | No authentication |
| `bearer` | Bearer token in Authorization header |
| `basic` | HTTP Basic authentication |
| `api_key` | API key in header or query |
| `oauth2` | OAuth 2.0 with token refresh |

### No Authentication

```vague
source PublicAPI {
  auth: none,
  base: "https://jsonplaceholder.typicode.com"
}
```

### Bearer Token

```vague
source GitHub {
  auth: bearer,
  base: "https://api.github.com"
}
```

Credentials are provided via CLI or config:

```json
{
  "GitHub": {
    "type": "bearer",
    "token": "ghp_xxxxxxxxxxxx"
  }
}
```

### API Key

```vague
source StripeAPI {
  auth: api_key,
  base: "https://api.stripe.com/v1"
}
```

```json
{
  "StripeAPI": {
    "type": "api_key",
    "key": "sk_live_xxxx",
    "header": "Authorization",
    "prefix": "Bearer"
  }
}
```

Or in query parameter:

```json
{
  "StripeAPI": {
    "type": "api_key",
    "key": "sk_live_xxxx",
    "query": "api_key"
  }
}
```

### Basic Authentication

```vague
source LegacyAPI {
  auth: basic,
  base: "https://legacy.example.com"
}
```

```json
{
  "LegacyAPI": {
    "type": "basic",
    "username": "user",
    "password": "pass"
  }
}
```

### OAuth 2.0

```vague
source Xero {
  auth: oauth2,
  base: "https://api.xero.com/api.xro/2.0"
}
```

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "current-access-token",
    "refreshToken": "current-refresh-token",
    "tokenUrl": "https://identity.xero.com/connect/token",
    "scopes": ["accounting.transactions.read"]
  }
}
```

Reqon automatically refreshes tokens when they expire.

## OpenAPI Spec Sources

Load source configuration from an OpenAPI specification:

```vague
source Petstore from "./petstore.yaml" {
  auth: bearer,
  validateResponses: true
}
```

Benefits:
- Base URL extracted from spec
- Operations available via `call` syntax
- Response validation against schemas

See [OpenAPI Integration](../category/openapi-integration) for details.

## Source Options

### Custom Headers

```vague
source CustomAPI {
  auth: bearer,
  base: "https://api.example.com",
  headers: {
    "X-Custom-Header": "value",
    "Accept": "application/json"
  }
}
```

### Rate Limiting

```vague
source RateLimitedAPI {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"
  }
}
```

Strategies:
- `pause` - Wait when limit reached
- `throttle` - Slow down requests
- `fail` - Throw error when limit reached

### Circuit Breaker

Prevent cascading failures:

```vague
source UnreliableAPI {
  auth: bearer,
  base: "https://flaky-api.example.com",
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2
  }
}
```

See [Circuit Breaker](../http/circuit-breaker) for details.

### Timeout

```vague
source SlowAPI {
  auth: bearer,
  base: "https://slow-api.example.com",
  timeout: 60000
}
```

## Using Sources

Sources are automatically selected when making requests:

```vague
mission MultiSource {
  source Primary { auth: bearer, base: "https://primary.example.com" }
  source Secondary { auth: bearer, base: "https://secondary.example.com" }

  action FetchFromPrimary {
    // Uses first source by default
    get "/data"
  }

  action FetchFromSecondary {
    // Explicitly use secondary source
    get Secondary "/data"
  }
}
```

### Default Source

The first defined source is the default:

```vague
mission Example {
  source API { auth: bearer, base: "https://api.example.com" }

  action Fetch {
    get "/users"  // Uses API source
  }
}
```

### Named Source Reference

Prefix requests with source name:

```vague
action FetchFromMultiple {
  get Primary "/users"
  get Secondary "/users"
}
```

## Source Variables

Use environment variables in source definitions:

```vague
source API {
  auth: bearer,
  base: env("API_BASE_URL")
}
```

## Multiple Environments

Pattern for handling different environments:

```vague
mission Sync {
  source API {
    auth: bearer,
    base: match env("ENVIRONMENT") {
      "production" => "https://api.example.com",
      "staging" => "https://staging.api.example.com",
      _ => "http://localhost:3000"
    }
  }
}
```

## Best Practices

### Use Descriptive Names

```vague
// Good
source XeroAccounting { }
source QuickBooksOnline { }
source StripePayments { }

// Avoid
source API1 { }
source Source { }
```

### Configure Appropriate Timeouts

```vague
// For fast APIs
source FastAPI {
  timeout: 5000  // 5 seconds
}

// For slow/bulk APIs
source BulkExportAPI {
  timeout: 300000  // 5 minutes
}
```

### Always Use Rate Limiting for Production

```vague
source ProductionAPI {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 100,
    strategy: "pause"
  }
}
```

### Enable Circuit Breakers for Unreliable Sources

```vague
source ThirdPartyAPI {
  auth: bearer,
  base: "https://third-party.example.com",
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  }
}
```
