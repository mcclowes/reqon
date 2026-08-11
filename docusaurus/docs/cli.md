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
| `--verbose` | Alias for `--log-level info` — shows a live progress line |
| `--log-level <level>` | Log verbosity: `debug`, `info`, `warn`, `error` (default: quiet) |
| `--log-format <fmt>` | Log output format: `text` (default) or `json` (JSON Lines) |
| `--dev` | Development mode: let `sql`/`nosql` stores fall back to local JSON files |
| `--auth <file>` | Path to a JSON file containing authentication credentials |
| `--env <file>` | Path to a .env file (default: .env in the current directory) |
| `--output <path>` | Export all stores to a single JSON file after execution |
| `--report <path>` | Write Vague dataset statistics as JSON, Markdown, or HTML |
| `--compare <path>` | Compare stores with a golden JSON dataset and fail on differences |
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

`--verbose` is an alias for `--log-level info`. Rather than narrating every
item, it prints a single progress line, throttled to at most once every two
seconds (or every 1,000 items), driven by loop and fetch events:

```bash
reqon sync-data.vague --verbose
```

```
12,431/500,000 (2.5%) · 87 req/s · p50 112ms · 3 retries · 0 failed · ETA 1h33m
```

Each console line is stamped with the elapsed time since the run started
(`+1234ms`).

### Log level and format

`--log-level` is the real verbosity knob:

```bash
reqon sync-data.vague --log-level debug   # progress line + per-item narration
reqon sync-data.vague --log-level warn    # warnings and errors only, no progress
```

- `debug` — everything, including per-request narration (`Fetched GET /users`,
  incremental-sync and pagination detail) with structured context.
- `info` — the throttled progress line and mission lifecycle events (what
  `--verbose` selects). Per-item narration is hidden.
- `warn` / `error` — resilience warnings and failures only; no progress line.

Use `--log-format json` to emit newline-delimited JSON (JSON Lines) instead of
human-readable text, for log aggregation. Progress ticks are emitted as
`{"type":"progress", ...}` objects:

```bash
reqon sync-data.vague --log-level info --log-format json
```

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

### Dataset reports

Write field statistics, distributions, record counts, and a Vague data
attestation after a run. The extension selects JSON, Markdown, or HTML:

```bash
reqon seed-test-data.vague --report ./artifacts/data-report.html
```

The attestation describes data as synthetic, so use this flag for generated or
test datasets rather than production data fetched from an API.

### Golden dataset comparison

Compare every exported store with a checked-in JSON snapshot:

```bash
reqon reconciliation.vague --compare ./testdata/reconciliation.golden.json
```

The comparison prints collection, record, and field differences. A mismatch
sets exit code 1, which makes the command suitable for CI regression checks.

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
          node-version: '22'
      - run: npm install
      - run: npx reqon ./missions/sync.vague --auth ./credentials.json
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}
```

### Docker

```dockerfile
FROM node:22-alpine
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
