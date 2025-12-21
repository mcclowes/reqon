---
sidebar_position: 4
---

# API Key Authentication

API key authentication sends a key in either a header or query parameter. Many SaaS APIs use this method.

## Configuration

### Mission File

```vague
source API {
  auth: api_key,
  base: "https://api.example.com"
}
```

### Credentials File

```json
{
  "API": {
    "type": "api_key",
    "key": "your-api-key",
    "header": "X-API-Key"
  }
}
```

## Credential Options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"api_key"` |
| `key` | Yes | The API key value |
| `header` | No* | Header name for the key |
| `query` | No* | Query parameter name for the key |
| `prefix` | No | Prefix for header value (e.g., "Bearer") |

*One of `header` or `query` is required.

## Header-Based API Key

### Standard Header

```json
{
  "API": {
    "type": "api_key",
    "key": "your-api-key",
    "header": "X-API-Key"
  }
}
```

Request:
```http
GET /api/data HTTP/1.1
X-API-Key: your-api-key
```

### Authorization Header with Prefix

```json
{
  "API": {
    "type": "api_key",
    "key": "your-api-key",
    "header": "Authorization",
    "prefix": "ApiKey"
  }
}
```

Request:
```http
GET /api/data HTTP/1.1
Authorization: ApiKey your-api-key
```

### Bearer-Style API Key

Some APIs use bearer format for API keys:

```json
{
  "API": {
    "type": "api_key",
    "key": "sk_live_xxxxx",
    "header": "Authorization",
    "prefix": "Bearer"
  }
}
```

Request:
```http
GET /api/data HTTP/1.1
Authorization: Bearer sk_live_xxxxx
```

## Query Parameter API Key

```json
{
  "API": {
    "type": "api_key",
    "key": "your-api-key",
    "query": "api_key"
  }
}
```

Request:
```http
GET /api/data?api_key=your-api-key HTTP/1.1
```

## Common API Examples

### SendGrid

```json
{
  "SendGrid": {
    "type": "api_key",
    "key": "SG.xxxxxxxxxxxx",
    "header": "Authorization",
    "prefix": "Bearer"
  }
}
```

### Mailchimp

```json
{
  "Mailchimp": {
    "type": "api_key",
    "key": "your-api-key-us1",
    "header": "Authorization",
    "prefix": "apikey"
  }
}
```

### OpenAI

```json
{
  "OpenAI": {
    "type": "api_key",
    "key": "sk-xxxxxxxxxxxx",
    "header": "Authorization",
    "prefix": "Bearer"
  }
}
```

### Google Maps

```json
{
  "GoogleMaps": {
    "type": "api_key",
    "key": "AIzaxxxxxxxxxxxxx",
    "query": "key"
  }
}
```

### Custom API

```json
{
  "CustomAPI": {
    "type": "api_key",
    "key": "your-api-key",
    "header": "X-Custom-Auth"
  }
}
```

## Environment Variables

### In Credentials

```json
{
  "API": {
    "type": "api_key",
    "key": "${API_KEY}",
    "header": "X-API-Key"
  }
}
```

### In Mission

```vague
source API {
  auth: api_key,
  base: "https://api.example.com",
  apiKey: env("API_KEY"),
  apiKeyHeader: "X-API-Key"
}
```

## Multiple API Keys

For APIs requiring multiple keys:

```vague
source API {
  auth: api_key,
  base: "https://api.example.com",
  headers: {
    "X-API-Key": env("API_KEY"),
    "X-App-ID": env("APP_ID")
  }
}
```

Or use custom header addition:

```json
{
  "API": {
    "type": "api_key",
    "key": "primary-key",
    "header": "X-API-Key",
    "additionalHeaders": {
      "X-App-ID": "your-app-id"
    }
  }
}
```

## Key Rotation

### Manual Rotation

1. Generate new key in provider dashboard
2. Update credentials file
3. Run mission

### Zero-Downtime Rotation

Some APIs support multiple active keys:

```json
{
  "API": {
    "type": "api_key",
    "key": "new-key",
    "header": "X-API-Key"
  }
}
```

1. Create new key (old still works)
2. Update credentials
3. Verify new key works
4. Revoke old key

## Error Handling

```vague
action FetchData {
  get "/data"

  match response {
    { error: "invalid_api_key" } -> abort "Invalid API key",
    { error: "expired_api_key" } -> abort "API key expired",
    { error: _, code: 401 } -> abort "Authentication failed",
    { error: _, code: 403 } -> abort "API key lacks permissions",
    _ -> continue
  }
}
```

## Security Best Practices

### Never Expose in URLs (When Possible)

Prefer header over query:

```json
// Better: key in header
{
  "type": "api_key",
  "key": "...",
  "header": "X-API-Key"
}

// Avoid: key in URL (may be logged)
{
  "type": "api_key",
  "key": "...",
  "query": "api_key"
}
```

### Use Environment Variables

```bash
export API_KEY="your-key"
```

### Restrict Key Permissions

Use keys with minimal required permissions.

## Troubleshooting

### "Invalid API Key"

1. Check key is correct
2. Check for extra whitespace
3. Verify key hasn't been revoked

### "Header Not Recognized"

Check the exact header name the API expects:

```json
// Case matters!
"header": "X-API-Key"  // Not "x-api-key"
```

### Key Being Sent Wrong

Debug by checking what's being sent:

```bash
reqon mission.vague --verbose
```
