---
sidebar_position: 2
---

# OAuth 2.0 Authentication

OAuth 2.0 is the industry standard for API authentication, used by most enterprise APIs. Reqon supports OAuth 2.0 with automatic token refresh.

## Configuration

### Mission file

```vague
source Xero {
  auth: oauth2,
  base: "https://api.xero.com/api.xro/2.0"
}
```

### Credentials file

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "current-access-token",
    "refreshToken": "current-refresh-token",
    "tokenUrl": "https://identity.xero.com/connect/token",
    "scopes": ["accounting.transactions.read", "accounting.contacts.read"],
    "expiresAt": "2024-01-20T10:30:00Z"
  }
}
```

## Credential options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"oauth2"` |
| `clientId` | Yes | OAuth client ID |
| `clientSecret` | Yes | OAuth client secret |
| `accessToken` | Yes | Current access token |
| `refreshToken` | Yes | Token used to get new access tokens |
| `tokenUrl` | Yes | Token endpoint URL |
| `scopes` | No | Requested scopes |
| `expiresAt` | No | When current token expires |

## Token refresh

### Automatic refresh

When `expiresAt` is set and token expires, Reqon automatically:

1. Calls `tokenUrl` with refresh token
2. Updates access token
3. Retries the failed request

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "...",
    "clientSecret": "...",
    "accessToken": "old-token",
    "refreshToken": "refresh-token",
    "tokenUrl": "https://identity.xero.com/connect/token",
    "expiresAt": "2024-01-20T10:30:00Z"
  }
}
```

### On 401 response

Even without `expiresAt`, Reqon refreshes on 401:

```vague
action FetchData {
  get "/data"
  // If 401, automatic refresh attempt
}
```

### Manual refresh pattern

For non-standard APIs:

```vague
action FetchData {
  get "/data"

  match response {
    { error: _, code: 401 } -> jump RefreshToken then retry,
    _ -> continue
  }
}

action RefreshToken {
  post "/oauth/token" {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: {
      grant_type: "refresh_token",
      refresh_token: env("REFRESH_TOKEN"),
      client_id: env("CLIENT_ID"),
      client_secret: env("CLIENT_SECRET")
    }
  }

  // Store new tokens
  store {
    accessToken: response.access_token,
    refreshToken: response.refresh_token
  } -> tokens
}
```

## Common OAuth2 providers

### Xero

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "...",
    "refreshToken": "...",
    "tokenUrl": "https://identity.xero.com/connect/token"
  }
}
```

### QuickBooks

```json
{
  "QuickBooks": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "...",
    "refreshToken": "...",
    "tokenUrl": "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
  }
}
```

### Salesforce

```json
{
  "Salesforce": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "...",
    "refreshToken": "...",
    "tokenUrl": "https://login.salesforce.com/services/oauth2/token"
  }
}
```

### Google APIs

```json
{
  "Google": {
    "type": "oauth2",
    "clientId": "your-client-id.apps.googleusercontent.com",
    "clientSecret": "your-client-secret",
    "accessToken": "...",
    "refreshToken": "...",
    "tokenUrl": "https://oauth2.googleapis.com/token"
  }
}
```

### Microsoft Graph

```json
{
  "Microsoft": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "...",
    "refreshToken": "...",
    "tokenUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/token"
  }
}
```

## Token storage

### File-based (development)

Tokens are stored in the credentials file. Reqon updates them after refresh.

### Secure storage (production)

For production, use secure storage:

```typescript
import { execute } from 'reqon';
import { getSecureTokens, saveSecureTokens } from './secure-storage';

const tokens = await getSecureTokens('Xero');

const result = await execute(source, {
  auth: {
    Xero: {
      type: 'oauth2',
      ...tokens
    }
  },
  onTokenRefresh: async (source, newTokens) => {
    await saveSecureTokens(source, newTokens);
  }
});
```

## Scopes

Request specific scopes:

```json
{
  "API": {
    "type": "oauth2",
    "scopes": [
      "read:users",
      "write:users",
      "read:orders"
    ]
  }
}
```

## Additional headers

Some APIs require extra headers:

```vague
source API {
  auth: oauth2,
  base: "https://api.example.com",
  headers: {
    "Xero-Tenant-Id": env("XERO_TENANT_ID")
  }
}
```

## Handling multi-tenant

For APIs like Xero with multiple organizations:

```vague
mission XeroSync {
  source Xero {
    auth: oauth2,
    base: "https://api.xero.com/api.xro/2.0",
    headers: {
      "Xero-Tenant-Id": env("XERO_TENANT_ID")
    }
  }
}
```

Or iterate over tenants:

```vague
action SyncAllTenants {
  get "/connections"

  for tenant in response {
    // Each tenant request
    get concat("/", tenant.tenantId, "/invoices") {
      headers: { "Xero-Tenant-Id": tenant.tenantId }
    }
  }
}
```

## Troubleshooting

### "invalid_grant" Error

Refresh token is invalid or expired. Re-authenticate:

1. Go through OAuth flow again
2. Get new access and refresh tokens
3. Update credentials file

### "Token expired" but no refresh

Ensure `refreshToken` and `tokenUrl` are set:

```json
{
  "API": {
    "refreshToken": "must-be-present",
    "tokenUrl": "must-be-present"
  }
}
```

### "Invalid client" error

Check `clientId` and `clientSecret` are correct.

### Scope issues

Ensure requested scopes are authorized for your app.
