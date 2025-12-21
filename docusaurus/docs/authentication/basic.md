---
sidebar_position: 5
---

# Basic Authentication

HTTP Basic Authentication sends username and password with each request, encoded in Base64. While simple, it should only be used over HTTPS.

## Configuration

### Mission file

```vague
source API {
  auth: basic,
  base: "https://api.example.com"
}
```

### Credentials file

```json
{
  "API": {
    "type": "basic",
    "username": "your-username",
    "password": "your-password"
  }
}
```

## How it works

Reqon encodes credentials and adds them to every request:

```http
GET /api/data HTTP/1.1
Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=
```

The value is `base64(username:password)`.

## Credential options

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"basic"` |
| `username` | Yes | The username |
| `password` | Yes | The password |

## Environment variables

### In credentials file

```json
{
  "API": {
    "type": "basic",
    "username": "${API_USERNAME}",
    "password": "${API_PASSWORD}"
  }
}
```

```bash
export API_USERNAME="myuser"
export API_PASSWORD="mypass"
reqon mission.vague --auth credentials.json
```

### In mission file

```vague
source API {
  auth: basic,
  base: "https://api.example.com",
  username: env("API_USERNAME"),
  password: env("API_PASSWORD")
}
```

## Common use cases

### Legacy systems

```vague
source LegacyERP {
  auth: basic,
  base: "https://erp.company.com/api"
}
```

### JIRA (Server)

```json
{
  "JIRA": {
    "type": "basic",
    "username": "user@company.com",
    "password": "api-token"
  }
}
```

### Bitbucket Server

```json
{
  "Bitbucket": {
    "type": "basic",
    "username": "username",
    "password": "app-password"
  }
}
```

### Jenkins

```json
{
  "Jenkins": {
    "type": "basic",
    "username": "admin",
    "password": "api-token"
  }
}
```

### Elasticsearch

```json
{
  "Elasticsearch": {
    "type": "basic",
    "username": "elastic",
    "password": "changeme"
  }
}
```

## Token as password

Many APIs use Basic auth with a token as password:

### Atlassian Cloud

```json
{
  "Atlassian": {
    "type": "basic",
    "username": "email@example.com",
    "password": "ATATT3xFfGF0..."  // API token
  }
}
```

### npm Registry

```json
{
  "NPM": {
    "type": "basic",
    "username": "username",
    "password": "npm_xxxxx"  // Access token
  }
}
```

## Error handling

```vague
action FetchData {
  get "/data"

  match response {
    { error: _, code: 401 } -> abort "Invalid credentials",
    { error: _, code: 403 } -> abort "Access denied",
    _ -> continue
  }
}
```

## Security considerations

### Always use HTTPS

Basic auth credentials are only Base64 encoded (not encrypted):

```vague
// Good
source API {
  auth: basic,
  base: "https://api.example.com"  // HTTPS
}

// DANGEROUS - credentials exposed
source API {
  auth: basic,
  base: "http://api.example.com"  // HTTP
}
```

### Prefer token-based auth

When available, use tokens instead:

```vague
// Preferred: token-based
source API {
  auth: bearer,
  base: "https://api.example.com"
}

// Use basic only when necessary
source LegacyAPI {
  auth: basic,
  base: "https://legacy.example.com"
}
```

### Use strong passwords

If using actual password (not token):
- Use a unique password for API access
- Enable MFA on the account if available
- Rotate regularly

## Credential rotation

### Rotate password

1. Update password in API provider
2. Update credentials file
3. Verify mission works

### Minimal disruption

```bash
# Update credentials
echo '{"API": {"type": "basic", "username": "user", "password": "new-pass"}}' > credentials.json

# Test
reqon mission.vague --dry-run --auth credentials.json

# Run
reqon mission.vague --auth credentials.json
```

## Troubleshooting

### "401 Unauthorized"

1. Verify username and password
2. Check for typos
3. Ensure account has API access

### "Encoding issues"

Check for special characters in password. They should be URL-safe or properly escaped:

```json
{
  "API": {
    "username": "user",
    "password": "pass:word@123"  // Special chars OK
  }
}
```

### "Connection refused"

Verify HTTPS is working:

```bash
curl -u "user:pass" https://api.example.com/health
```
