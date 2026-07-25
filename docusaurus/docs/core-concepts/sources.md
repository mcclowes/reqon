---
sidebar_position: 3
---

# Sources

A **Source** defines an API endpoint that your mission connects to. Sources configure authentication, base URLs, rate limiting, and other HTTP client options.

## Basic syntax

```vague
source SourceName {
  auth: authType,
  base: "https://api.example.com"
}
```

## Authentication types

The `auth:` value is just the type; there's no sub-config in the DSL, and credentials never go in the `source {}` block. They come from an auth file (`--auth <file>`) or environment variables.

| Type | Description |
|------|-------------|
| `none` | No authentication |
| `bearer` | Bearer token in the Authorization header |
| `basic` | HTTP Basic authentication |
| `api_key` | API key in a request header |
| `oauth2` | OAuth 2.0 with token refresh |

:::note Runtime support
Only `bearer` and `oauth2` are wired up at runtime today. `basic` and `api_key` parse fine, but no auth provider is attached, so requests go out unauthenticated. Treat them as not yet implemented.
:::

### No authentication

```vague
source PublicAPI {
  auth: none,
  base: "https://jsonplaceholder.typicode.com"
}
```

### Bearer token

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
    "apiKey": "sk_live_xxxx",
    "headerName": "X-API-Key"
  }
}
```

`headerName` defaults to `X-API-Key`. API keys are placed in a header only; there's no query-parameter option. (As noted above, `api_key` isn't applied at runtime yet.)

### Basic authentication

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
    "tokenEndpoint": "https://identity.xero.com/connect/token"
  }
}
```

Reqon refreshes tokens when they expire, but the refreshed token is held in memory only for the current run.

## OpenAPI spec sources

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

## Source options

### Custom headers

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

### Rate limiting

```vague
source RateLimitedAPI {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause,
    maxWait: 300,
    fallbackRpm: 60
  }
}
```

Options:
- `strategy` (unquoted identifier) - one of `pause`, `throttle`, or `fail`
- `maxWait` - longest wait in seconds before giving up (default 300)
- `fallbackRpm` - requests per minute to assume when the API sends no rate-limit headers (default 60)

Strategies:
- `pause` - wait when the limit is reached
- `throttle` - slow down requests
- `fail` - throw an error when the limit is reached

### Circuit breaker

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

The full set of options is `failureThreshold` (default 5), `resetTimeout` in milliseconds (default 30000), `successThreshold` (default 2), and `failureWindow` in milliseconds (default 60000). See [Circuit Breaker](../http/circuit-breaker) for details.

## Using sources

The first defined source is used by default. To target another source, set the `source` option on the request:

```vague
mission MultiSource {
  source Primary { auth: bearer, base: "https://primary.example.com" }
  source Secondary { auth: bearer, base: "https://secondary.example.com" }

  action FetchFromPrimary {
    // Uses the first source by default
    get "/data"
  }

  action FetchFromSecondary {
    // Explicitly use the secondary source
    get "/data" { source: Secondary }
  }
}
```

### Default source

The first defined source is the default:

```vague
mission Example {
  source API { auth: bearer, base: "https://api.example.com" }

  action Fetch {
    get "/users"  // Uses API source
  }
}
```

### Named source reference

Set the `source` option to pick a source per request:

```vague
action FetchFromMultiple {
  get "/users" { source: Primary }
  get "/users" { source: Secondary }
}
```

## Best practices

### Use descriptive names

```vague
// Good
source XeroAccounting { }
source QuickBooksOnline { }
source StripePayments { }

// Avoid
source API1 { }
source Source { }
```

### Always use rate limiting for production

```vague
source ProductionAPI {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    strategy: pause,
    fallbackRpm: 100
  }
}
```

### Enable circuit breakers for unreliable sources

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
