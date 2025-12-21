---
sidebar_position: 3
description: Complete reference for the Reqon CLI including options for dry-run, daemon mode, webhooks, authentication, and CI/CD integration.
keywords: [reqon, CLI, command line, daemon, webhook, CI/CD]
---

# Command line interface

Reqon provides a powerful CLI for running and managing missions.

## Basic usage

```bash
reqon <file-or-folder> [options]
```

Run a single mission file:

```bash
reqon sync-customers.vague
```

Run a mission folder (multi-file mission):

```bash
reqon ./missions/customer-sync/
```

## Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Parse and validate without executing HTTP requests |
| `--verbose` | Enable detailed logging output |
| `--auth <file>` | Path to JSON file containing authentication credentials |
| `--env <file>` | Path to .env file (default: .env in current directory) |
| `--output <path>` | Export store contents to JSON files after execution |
| `--daemon` | Run scheduled missions continuously |
| `--once` | Run scheduled missions once, then exit |
| `--webhook` | Enable webhook server for `wait` steps |
| `--webhook-port <n>` | Port for webhook server (default: 3000) |
| `--webhook-url <url>` | Base URL for webhook endpoints (default: http://localhost:3000) |

## Examples

### Dry run mode

Validate your mission syntax without making actual API calls:

```bash
reqon sync-data.vague --dry-run
```

### Verbose output

Get detailed execution logs:

```bash
reqon sync-data.vague --verbose
```

Output includes:
- HTTP request/response details
- Pagination progress
- Store operation counts
- Timing information

### Authentication

Provide credentials via a JSON file:

```bash
reqon sync-data.vague --auth ./credentials.json
```

The credentials file should match your source names:

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "accessToken": "current-token",
    "refreshToken": "refresh-token",
    "tokenUrl": "https://identity.xero.com/connect/token"
  },
  "GitHub": {
    "type": "bearer",
    "token": "ghp_xxxxxxxxxxxx"
  }
}
```

### Exporting results

Save store contents to JSON after execution:

```bash
reqon sync-data.vague --output ./output/
```

This creates JSON files for each store:
```
output/
├── customers.json
├── orders.json
└── products.json
```

### Daemon mode

Run scheduled missions continuously:

```bash
reqon ./missions/ --daemon
```

The daemon will:
- Parse all missions in the folder
- Execute scheduled missions according to their schedule
- Respect rate limits and backoff strategies
- Handle graceful shutdown on SIGINT/SIGTERM

### One-shot scheduled execution

Run all scheduled missions once:

```bash
reqon ./missions/ --once
```

Useful for cron-triggered executions where you want external scheduling.

### Webhook server

Enable the webhook server for missions that use `wait` steps:

```bash
reqon payment-flow.vague --webhook --verbose
```

With custom port and URL (for production or tunnels):

```bash
reqon payment-flow.vague --webhook --webhook-port 8080 --webhook-url https://my-server.ngrok.io
```

### Environment files

Load environment variables from a specific file:

```bash
reqon sync-data.vague --env .env.production --auth ./credentials.json
```

The `--env` flag supports:
- Custom `.env` file paths
- Environment variable interpolation in auth files

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (HTTP failure, validation error, etc.) |
| 2 | Parse error (invalid syntax) |
| 3 | Configuration error (missing credentials, invalid options) |

## Environment variables

| Variable | Description |
|----------|-------------|
| `REQON_STATE_DIR` | Directory for execution state (default: `.vague-data`) |
| `REQON_LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, `error` |
| `REQON_DRY_RUN` | Enable dry-run mode (same as `--dry-run`) |

### Auto-discovery from environment

Reqon can automatically discover credentials from environment variables:

| Variable Pattern | Description |
|------------------|-------------|
| `REQON_{SOURCE}_TOKEN` | Bearer token for a source |
| `REQON_{SOURCE}_TYPE` | Auth type: `bearer`, `oauth2`, `api_key`, `basic` |
| `REQON_{SOURCE}_API_KEY` | API key for a source |

Example:
```bash
export REQON_GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
export REQON_GITHUB_TYPE="bearer"

# No --auth file needed for GitHub source
reqon sync-repos.vague
```

### Credential file interpolation

Auth files support environment variable interpolation:

```json
{
  "Xero": {
    "type": "oauth2",
    "clientId": "$XERO_CLIENT_ID",
    "clientSecret": "${XERO_CLIENT_SECRET}",
    "accessToken": "${XERO_ACCESS_TOKEN:-default-token}"
  }
}
```

Supported formats:
- `$VAR_NAME` - Simple variable
- `${VAR_NAME}` - Braced variable
- `${VAR_NAME:-default}` - With default value

## Multi-file missions

For complex missions, organize them as folders:

```
missions/
└── customer-sync/
    ├── mission.vague     # Main mission definition
    ├── actions/
    │   ├── fetch.vague   # Fetch action
    │   ├── transform.vague
    │   └── export.vague
    └── schemas/
        └── customer.vague
```

Run with:

```bash
reqon ./missions/customer-sync/
```

Reqon automatically discovers and loads all `.vague` files in the folder.

## Integrating with CI/CD

### GitHub Actions

```yaml
name: Sync Data
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npx reqon ./missions/sync.vague --auth ./credentials.json
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npx", "reqon", "./missions/", "--daemon"]
```

## Troubleshooting

### "Cannot find module 'reqon'"

Ensure Reqon is installed:

```bash
npm install reqon
```

### "Permission denied"

The state directory (`.vague-data`) needs write access:

```bash
chmod 755 .vague-data
```

### Debugging HTTP issues

Use verbose mode to see request/response details:

```bash
reqon mission.vague --verbose 2>&1 | tee debug.log
```
