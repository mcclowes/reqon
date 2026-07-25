---
sidebar_position: 2
---

# OAuth 2.0 authentication

OAuth 2.0 is a common choice for enterprise APIs. Reqon sends your access token as a bearer token and refreshes it when a request comes back with a `401`.

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
    "tokenEndpoint": "https://identity.xero.com/connect/token"
  }
}
```

## Credential options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"oauth2"` |
| `accessToken` | Yes | Current access token, sent on every request |
| `refreshToken` | For refresh | Token used to get a new access token |
| `tokenEndpoint` | For refresh | Token endpoint URL the refresh request posts to |
| `clientId` | For refresh | OAuth client ID, sent in the refresh request |
| `clientSecret` | No | OAuth client secret, sent in the refresh request if present |

Reqon never reads `expiresAt` or `scopes` from credentials, so don't add them. Scoping is decided when you generate the token with the provider.

## Token refresh

Reqon doesn't track token expiry. It sends `accessToken` as a bearer token, and when a request comes back with a `401`, it refreshes once and retries:

1. Posts to `tokenEndpoint` with `grant_type=refresh_token`, the refresh token, and the client ID (and secret, if set).
2. Replaces the in-memory access token with the new one.
3. Retries the request once.

```vague
action FetchData {
  get "/data"
  // On 401, Reqon refreshes the token and retries this request once.
}
```

The refreshed token lives in memory for the rest of the run only. It is not written back to the credentials file, so the next run starts from the original `accessToken` again. Refresh needs `refreshToken` and `tokenEndpoint`; without them, a `401` just fails.

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
    "tokenEndpoint": "https://identity.xero.com/connect/token"
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
    "tokenEndpoint": "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
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
    "tokenEndpoint": "https://login.salesforce.com/services/oauth2/token"
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
    "tokenEndpoint": "https://oauth2.googleapis.com/token"
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
    "tokenEndpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/token"
  }
}
```

## Token storage

Tokens come from the credentials file or environment variables. When Reqon refreshes a token on a `401`, the new token is kept in memory for the rest of the run only — it is not written back to the credentials file. Each new run starts from the `accessToken` you supplied, so refresh your stored token out of band if it has rotated.

You can also pass credentials programmatically:

```typescript
import { execute } from 'reqon';
import { getSecureTokens } from './secure-storage';

const tokens = await getSecureTokens('Xero');

const result = await execute(source, {
  auth: {
    Xero: {
      type: 'oauth2',
      ...tokens
    }
  }
});
```

## Troubleshooting

### "invalid_grant" error

The refresh token is invalid or expired. Re-authenticate:

1. Go through the OAuth flow again.
2. Get new access and refresh tokens.
3. Update the credentials file.

### Token expired but no refresh

Ensure `refreshToken` and `tokenEndpoint` are set:

```json
{
  "API": {
    "refreshToken": "must-be-present",
    "tokenEndpoint": "must-be-present"
  }
}
```

### "Invalid client" error

Check `clientId` and `clientSecret` are correct.

### Scope issues

Ensure the token you generated with the provider has the scopes the API requires.
