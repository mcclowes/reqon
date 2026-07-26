---
sidebar_position: 1
description: Configure authentication for Reqon API sources including OAuth2, Bearer tokens, API keys, and Basic auth with automatic token refresh.
keywords: [reqon, authentication, OAuth2, bearer token, API key, credentials]
---

# Authentication overview

Reqon supports multiple authentication methods for connecting to APIs. Authentication is configured at the source level and credentials are provided via CLI or configuration files.

## Supported auth types

| Type | Description | Use Case |
|------|-------------|----------|
| `none` | No authentication | Public APIs |
| `bearer` | Bearer token | Most REST APIs |
| `basic` | HTTP basic auth | Legacy systems |
| `api_key` | API key in a header | Many SaaS APIs |
| `oauth2` | OAuth 2.0 with refresh | Enterprise APIs |

:::warning Runtime support
All five types parse, but only `bearer` and `oauth2` actually attach credentials to requests today. `basic` and `api_key` parse without error, but no auth is applied at runtime, so requests go out unauthenticated. See the [basic](./basic.md) and [api key](./api-key.md) pages for details.
:::

The `auth:` value in a `source` block is only the type. Credentials are never written inline in the source block. They come from a `--auth <file>` JSON file keyed by source name, or from `REQON_{SOURCE}_{FIELD}` environment variables.

## Quick start

### In mission file

```vague
source API {
  auth: bearer,
  base: "https://api.example.com"
}
```

### Credentials file

Create `credentials.json`:

```json
{
  "API": {
    "type": "bearer",
    "token": "your-api-token"
  }
}
```

### Run with credentials

```bash
reqon mission.vague --auth ./credentials.json
```

## Credential sources

### File-based

```bash
reqon mission.vague --auth ./credentials.json
```

### Environment variables

Reference in credentials:

```json
{
  "API": {
    "type": "bearer",
    "token": "${API_TOKEN}"
  }
}
```

The `${VAR}` reference also supports a default with `${VAR:-fallback}`. A reference with no value and no default throws rather than sending an empty credential.

### Auto-discovered environment variables

You don't need a credentials file at all. Reqon looks for variables named `REQON_{SOURCE}_{FIELD}`, where `{SOURCE}` is the uppercased source name. For a source named `API`:

```bash
export REQON_API_TYPE="bearer"
export REQON_API_TOKEN="your-token"
reqon mission.vague
```

Recognized fields are `TYPE`, `TOKEN`, `ACCESS_TOKEN`, `REFRESH_TOKEN`, `TOKEN_ENDPOINT`, `CLIENT_ID`, `CLIENT_SECRET`, `API_KEY`, `HEADER_NAME`, `USERNAME`, and `PASSWORD`. If a token is set without a type, the type defaults to `bearer`.

### Programmatic

```typescript
import { execute } from 'reqon-dsl';

await execute(source, {
  auth: {
    API: {
      type: 'bearer',
      token: process.env.API_TOKEN
    }
  }
});
```

## Multiple sources

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
    "tokenEndpoint": "https://identity.xero.com/connect/token"
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

## Refreshing tokens

For `oauth2` sources, Reqon refreshes the access token when a request comes back with a `401`. It posts to `tokenEndpoint` with the refresh token, then retries the request once with the new token:

```json
{
  "Xero": {
    "type": "oauth2",
    "accessToken": "current-token",
    "refreshToken": "refresh-token",
    "tokenEndpoint": "https://identity.xero.com/connect/token",
    "clientId": "...",
    "clientSecret": "..."
  }
}
```

The refreshed token is held in memory for the rest of the run. It is not written back to the credentials file, so the next run starts from the original `accessToken` again.

Bearer tokens are not refreshed. If a bearer token expires, the request fails and you'll need to update the credentials.

## Security best practices

:::danger Never Commit Credentials
Always add credential files to `.gitignore` before committing. Exposed API tokens can lead to unauthorized access and data breaches.
:::

### Never commit credentials

Add to `.gitignore`:

```
credentials.json
.env
*.pem
*.key
```

### Use environment variables

```bash
export API_TOKEN="your-token"
reqon mission.vague
```

### Rotate tokens regularly

For OAuth2, ensure refresh tokens are valid.

:::tip Use environment variables
Store credentials in environment variables for local development and use secret management services (AWS Secrets Manager, HashiCorp Vault) in production.
:::

### Use least privilege

Request only the scopes you need when you generate the token with the provider. Reqon sends whatever access token you give it, so scoping happens on the provider's side.

## Troubleshooting

### Authentication failed

1. Check the credentials file path.
2. Verify the token is valid.
3. Check the source name matches the credentials key.

### Token expired

For OAuth2, ensure:
- `refreshToken` is present.
- `tokenEndpoint` is correct.
- The token hasn't been revoked.

### Wrong auth type

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
