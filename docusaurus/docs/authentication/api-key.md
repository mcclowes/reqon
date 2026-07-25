---
sidebar_position: 4
---

# API key authentication

API key authentication sends a key in a request header. Many SaaS APIs use this method.

:::warning Not applied at runtime
`auth: api_key` parses, and Reqon recognizes API key credentials in a credentials file, but no auth provider is built for it yet. At runtime, requests to an `api_key` source go out **unauthenticated** — Reqon does not add the API key header. This page documents the configuration shape Reqon recognizes, but the key is not sent. If your API accepts the key as a bearer token (in `Authorization: Bearer ...`), use [bearer](./bearer.md) instead, which does work end to end.
:::

## Configuration

### Mission file

```vague
source API {
  auth: api_key,
  base: "https://api.example.com"
}
```

### Credentials file

```json
{
  "API": {
    "type": "api_key",
    "apiKey": "your-api-key",
    "headerName": "X-API-Key"
  }
}
```

## Credential options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"api_key"` |
| `apiKey` | Yes | The API key value |
| `headerName` | No | Header name for the key (default `X-API-Key`) |

There is no query-parameter placement and no value prefix. The key is only ever a header value, and the header name defaults to `X-API-Key` when omitted.

## Environment variables

### In the credentials file

```json
{
  "API": {
    "type": "api_key",
    "apiKey": "${API_KEY}",
    "headerName": "X-API-Key"
  }
}
```

```bash
export API_KEY="your-key"
reqon mission.vague --auth credentials.json
```

The source block only declares the auth type. The key never goes inline in the source block.

### Auto-discovered environment variables

Reqon reads `REQON_{SOURCE}_{FIELD}`, where `{SOURCE}` is the uppercased source name. For a source named `API`:

```bash
export REQON_API_TYPE="api_key"
export REQON_API_API_KEY="your-key"
export REQON_API_HEADER_NAME="X-API-Key"
reqon mission.vague
```

## Common API examples

### Standard header

```json
{
  "API": {
    "type": "api_key",
    "apiKey": "your-api-key",
    "headerName": "X-API-Key"
  }
}
```

### Custom header name

```json
{
  "CustomAPI": {
    "type": "api_key",
    "apiKey": "your-api-key",
    "headerName": "X-Custom-Auth"
  }
}
```

:::tip Bearer-style keys
APIs such as SendGrid, OpenAI, and Stripe expect the key in `Authorization: Bearer <key>`. Those aren't header-name API keys — configure them as [bearer](./bearer.md) sources, which Reqon sends correctly.
:::

## Key rotation

### Manual rotation

1. Generate a new key in the provider dashboard.
2. Update the credentials file.
3. Run the mission.

### Zero-downtime rotation

Some APIs support multiple active keys:

1. Create a new key (the old one still works).
2. Update the credentials.
3. Verify the new key works.
4. Revoke the old key.

## Security best practices

### Use environment variables

```bash
export API_KEY="your-key"
```

### Restrict key permissions

Use keys with the minimum required permissions.

## Troubleshooting

### "Invalid API key"

1. Check the key is correct.
2. Check for extra whitespace.
3. Verify the key hasn't been revoked.

### Header name mismatch

The header name is case-sensitive on some servers. Match exactly what the API expects:

```json
"headerName": "X-API-Key"
```
