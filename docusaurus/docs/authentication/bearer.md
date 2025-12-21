---
sidebar_position: 3
---

# Bearer Token Authentication

Bearer token authentication is the most common auth method for REST APIs. The token is sent in the `Authorization` header with each request.

## Configuration

### Mission File

```vague
source API {
  auth: bearer,
  base: "https://api.example.com"
}
```

### Credentials File

```json
{
  "API": {
    "type": "bearer",
    "token": "your-api-token"
  }
}
```

## How It Works

Reqon adds the token to every request:

```http
GET /api/users HTTP/1.1
Host: api.example.com
Authorization: Bearer your-api-token
```

## Credential Options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"bearer"` |
| `token` | Yes | The bearer token |

## Environment Variables

### In Credentials File

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

### In Mission File

```vague
source API {
  auth: bearer,
  base: "https://api.example.com",
  token: env("API_TOKEN")
}
```

## Common Use Cases

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

## Token Rotation

### Manual Rotation

1. Generate new token in API provider
2. Update credentials file
3. Run mission

### Programmatic Rotation

```typescript
import { execute } from 'reqon';

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

## Handling Expiration

Bearer tokens may expire. Handle with match:

```vague
action FetchData {
  get "/data"

  match response {
    { error: _, code: 401 } -> abort "Token expired - please update credentials",
    _ -> continue
  }
}
```

Or with token refresh:

```vague
action FetchData {
  get "/data"

  match response {
    { error: _, code: 401 } -> jump RefreshToken then retry,
    _ -> continue
  }
}

action RefreshToken {
  post "/auth/token" {
    body: { apiKey: env("API_KEY") }
  }
  // Response contains new token
}
```

## Multiple Tokens

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

## Security Best Practices

### Store Tokens Securely

```bash
# Never commit tokens
echo "credentials.json" >> .gitignore
```

### Use Environment Variables

```bash
export API_TOKEN=$(cat ~/.secrets/api-token)
```

### Rotate Regularly

Set up periodic token rotation in your CI/CD pipeline.

### Use Minimal Scopes

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

### Token Not Being Sent

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
