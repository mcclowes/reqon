---
sidebar_position: 3
description: Complete reference for the Reqon CLI including options for dry-run, daemon mode, webhooks, authentication, and CI/CD integration.
keywords: [reqon, CLI, command line, daemon, webhook, CI/CD]
---

# Command line interface

Reqon provides a CLI for running and managing missions. The CLI is the `reqon` binary; install the `reqon-dsl` package to get it.

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
| `--dry-run` | Run without making actual HTTP requests |
| `--verbose` | Enable detailed logging output |
| `--dev` | Development mode: let `sql`/`nosql` stores fall back to local JSON files |
| `--auth <file>` | Path to a JSON file containing authentication credentials |
| `--env <file>` | Path to a .env file (default: .env in the current directory) |
| `--output <path>` | Export all stores to a single JSON file after execution |
| `--daemon` | Run as a daemon, executing scheduled missions |
| `--once` | Run scheduled missions once immediately, then exit |
| `--webhook` | Enable the webhook server for `wait` steps |
| `--webhook-port <n>` | Port for the webhook server (default: 3000) |
| `--webhook-url <url>` | Base URL for webhook endpoints (default: http://localhost:3000) |
| `--control` | Enable the control server for pause/resume and status queries |
| `--control-port <n>` | Port for the control server (default: 3001) |
| `--debug` | Enable step-through debugging |
| `--resume <id>` | Resume a paused or failed execution by ID |
| `--help`, `-h` | Show the help message |

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
    "tokenEndpoint": "https://identity.xero.com/connect/token"
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
reqon sync-data.vague --output ./output.json
```

This writes a single JSON file, an object keyed by store name, with each store's items as an array:

```json
{
  "customers": [ { "id": 1, "name": "Ada" } ],
  "orders": [ { "id": 100, "customerId": 1 } ]
}
```

### Daemon mode

Run scheduled missions continuously:

```bash
reqon ./missions/ --daemon
```

The daemon:
- Parses all missions in the folder
- Executes scheduled missions according to their schedule
- Respects rate limits and backoff strategies
- Handles graceful shutdown on SIGINT/SIGTERM

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

### Control server

Enable the control server to pause, resume, and inspect a running mission:

```bash
reqon long-running.vague --control --control-port 3001 --verbose
```

When `--control` is enabled, the server exposes these endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/pause` | Request a graceful pause at the next safe point |
| `POST` | `/resume` | Clear a pause request |
| `GET` | `/status` | Get the current execution state and progress |
| `GET` | `/health` | Health check |

### Resuming an execution

If a mission pauses or fails, the CLI prints its execution ID. Resume it with `--resume`:

```bash
reqon long-running.vague --resume exec_abc123
```

### Development mode

Let `sql` and `nosql` stores fall back to local JSON files instead of requiring a database:

```bash
reqon sync-data.vague --dev
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
| 1 | Failure (parse error, runtime error, validation error, missing scheduled mission, etc.) |

A paused mission also exits with code 0; resume it with `--resume`.

## Environment variables

The CLI reads `.env` files (via `--env` or a `.env` in the current directory) and discovers per-source credentials from the environment. It does not read configuration flags from environment variables.

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

For complex missions, organize them as a folder with a `mission.vague` root file plus one action file per action, all in the same directory:

```
missions/
└── customer-sync/
    ├── mission.vague     # Sources, stores, schemas, and the pipeline
    ├── fetch.vague       # Action file
    ├── transform.vague   # Action file
    └── export.vague      # Action file
```

Run with:

```bash
reqon ./missions/customer-sync/
```

Reqon loads `mission.vague` and merges every other `.vague` file in the folder as an action. The files sit side by side; nested subfolders are not scanned.

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

### "Cannot find module 'reqon-dsl'"

Ensure Reqon is installed:

```bash
npm install reqon-dsl
```

### "Permission denied"

The data directory (`.reqon-data`) needs write access:

```bash
chmod 755 .reqon-data
```

### Debugging HTTP issues

Use verbose mode to see request/response details:

```bash
reqon mission.vague --verbose 2>&1 | tee debug.log
```
