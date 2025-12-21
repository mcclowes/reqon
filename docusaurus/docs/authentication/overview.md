---
sidebar_position: 1
---

# Authentication Overview

Reqon supports multiple authentication methods for connecting to APIs. Authentication is configured at the source level and credentials are provided via CLI or configuration files.

## Supported Auth Types

| Type | Description | Use Case |
|------|-------------|----------|
| `none` | No authentication | Public APIs |
| `bearer` | Bearer token | Most REST APIs |
| `basic` | HTTP Basic Auth | Legacy systems |
| `api_key` | API key in header/query | Many SaaS APIs |
| `oauth2` | OAuth 2.0 with refresh | Enterprise APIs |

## Quick Start

### In Mission File

```vague
source API {
  auth: bearer,
  base: "https://api.example.com"
}
```

### Credentials File

Create `credentials.json`:

```json
{
  "API": {
    "type": "bearer",
    "token": "your-api-token"
  }
}
```

### Run with Credentials

```bash
reqon mission.vague --auth ./credentials.json
```

## Credential Sources

### File-Based

```bash
reqon mission.vague --auth ./credentials.json
```

### Environment Variables

Reference in credentials:

```json
{
  "API": {
    "type": "bearer",
    "token": "${API_TOKEN}"
  }
}
```

Or in mission file:

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  token: env("API_TOKEN")
}
```

### Programmatic

```typescript
import { execute } from 'reqon';

await execute(source, {
  auth: {
    API: {
      type: 'bearer',
      token: process.env.API_TOKEN
    }
  }
});
```

## Multiple Sources

Handle multiple APIs with different auth:

```vague
mission MultiSource {
  source Xero {
    auth: oauth2,
    base: "https://api.xero.com/api.xro/2.0"
  }

  source Stripe {
    auth: bearer,
    base: "https://api.stripe.com/v1"
  }

  source Legacy {
    auth: basic,
    base: "https://legacy.example.com"
  }
}
```

Credentials file:

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "...",
    "clientSecret": "...",
    "accessToken": "...",
    "refreshToken": "...",
    "tokenUrl": "https://identity.xero.com/connect/token"
  },
  "Stripe": {
    "type": "bearer",
    "token": "sk_live_..."
  },
  "Legacy": {
    "type": "basic",
    "username": "admin",
    "password": "secret"
  }
}
```

## Refreshing Tokens

### OAuth 2.0 Automatic Refresh

Reqon automatically refreshes OAuth2 tokens when they expire:

```json
{
  "Xero": {
    "type": "oauth2",
    "accessToken": "current-token",
    "refreshToken": "refresh-token",
    "tokenUrl": "https://identity.xero.com/connect/token",
    "expiresAt": "2024-01-20T10:30:00Z"
  }
}
```

### Manual Refresh with Jump

For non-standard token refresh:

```vague
action FetchData {
  get "/data"

  match response {
    { error: _, code: 401 } -> jump RefreshToken then retry,
    _ -> continue
  }
}

action RefreshToken {
  post "/auth/refresh" {
    body: { refreshToken: env("REFRESH_TOKEN") }
  }
  // Response updates auth context
}
```

## Security Best Practices

### Never Commit Credentials

Add to `.gitignore`:

```
credentials.json
.env
*.pem
*.key
```

### Use Environment Variables

```bash
export API_TOKEN="your-token"
reqon mission.vague
```

### Rotate Tokens Regularly

For OAuth2, ensure refresh tokens are valid.

### Use Least Privilege

Request only necessary scopes:

```json
{
  "API": {
    "type": "oauth2",
    "scopes": ["read:users", "read:orders"]
  }
}
```

## Troubleshooting

### "Authentication Failed" Error

1. Check credentials file path
2. Verify token is valid
3. Check source name matches credentials

### Token Expired

For OAuth2, ensure:
- `refreshToken` is present
- `tokenUrl` is correct
- Token hasn't been revoked

### Wrong Auth Type

Match the type in credentials to mission:

```vague
// Mission says bearer
source API { auth: bearer, base: "..." }
```

```json
// Credentials must also be bearer
{
  "API": {
    "type": "bearer",  // Must match
    "token": "..."
  }
}
```
