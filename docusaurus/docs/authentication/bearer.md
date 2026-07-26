---
sidebar_position: 3
---

# Bearer token authentication

Bearer token authentication is the most common auth method for REST APIs. The token is sent in the `Authorization` header with each request.

## Configuration

### Mission file

```vague
source API {
  auth: bearer,
  base: "https://api.example.com"
}
```

### Credentials file

```json
{
  "API": {
    "type": "bearer",
    "token": "your-api-token"
  }
}
```

## How it works

Reqon adds the token to every request:

```http
GET /api/users HTTP/1.1
Host: api.example.com
Authorization: Bearer your-api-token
```

## Credential options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"bearer"` |
| `token` | Yes | The bearer token |

## Environment variables

### In credentials file

```json
{
  "API": {
    "type": "bearer",
    "token": "${API_TOKEN}"
  }
}
```

Then set the environment variable:

```bash
export API_TOKEN="your-token"
reqon mission.vague --auth credentials.json
```

The source block only declares the auth type. The token never goes inline in the source block; it always comes from the credentials file or an environment variable.

### Auto-discovered environment variables

You can skip the credentials file entirely. Reqon reads `REQON_{SOURCE}_{FIELD}`, where `{SOURCE}` is the uppercased source name. For a source named `API`:

```bash
export REQON_API_TOKEN="your-token"
reqon mission.vague
```

A token with no explicit type defaults to `bearer`.

## Common use cases

### GitHub API

```vague
source GitHub {
  auth: bearer,
  base: "https://api.github.com"
}
```

```json
{
  "GitHub": {
    "type": "bearer",
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx"
  }
}
```

### Stripe API

```vague
source Stripe {
  auth: bearer,
  base: "https://api.stripe.com/v1"
}
```

```json
{
  "Stripe": {
    "type": "bearer",
    "token": "sk_live_xxxxxxxxxxxxxxxxxxxx"
  }
}
```

### Custom API

```vague
source CustomAPI {
  auth: bearer,
  base: "https://api.mycompany.com/v1"
}
```

```json
{
  "CustomAPI": {
    "type": "bearer",
    "token": "your-custom-token"
  }
}
```

## Token rotation

### Manual rotation

1. Generate new token in API provider
2. Update credentials file
3. Run mission

### Programmatic rotation

```typescript
import { execute } from 'reqon-dsl';

const token = await fetchNewToken(); // Your logic

await execute(source, {
  auth: {
    API: {
      type: 'bearer',
      token
    }
  }
});
```

## Handling expiration

Bearer tokens are sent as-is and are not refreshed. If a bearer token expires, the request fails with a `401` and the mission stops. To recover, update the token in your credentials file or environment variable and run again. If you need automatic refresh on `401`, use [OAuth 2.0](./oauth2.md) instead.

## Multiple tokens

For APIs requiring different tokens per endpoint:

```vague
source ReadAPI {
  auth: bearer,
  base: "https://api.example.com"
}

source WriteAPI {
  auth: bearer,
  base: "https://api.example.com"
}
```

```json
{
  "ReadAPI": {
    "type": "bearer",
    "token": "read-only-token"
  },
  "WriteAPI": {
    "type": "bearer",
    "token": "write-token"
  }
}
```

## Security best practices

### Store tokens securely

```bash
# Never commit tokens
echo "credentials.json" >> .gitignore
```

### Use environment variables

```bash
export API_TOKEN=$(cat ~/.secrets/api-token)
```

### Rotate regularly

Set up periodic token rotation in your CI/CD pipeline.

### Use minimal scopes

If the API supports scoped tokens, use the minimum required permissions.

## Troubleshooting

### "401 Unauthorized"

1. Check token is correct
2. Check token hasn't expired
3. Verify token has required permissions

### "Invalid token format"

Ensure token doesn't have extra whitespace:

```json
{
  "API": {
    "type": "bearer",
    "token": "your-token"  // No leading/trailing spaces
  }
}
```

### Token not being sent

Verify source name matches:

```vague
source MyAPI { auth: bearer }  // Name: MyAPI
```

```json
{
  "MyAPI": {  // Must match exactly
    "type": "bearer",
    "token": "..."
  }
}
```
