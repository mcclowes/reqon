---
sidebar_position: 3
---

# Command Line Interface

Reqon provides a powerful CLI for running and managing missions.

## Basic Usage

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
| `--output <path>` | Export store contents to JSON files after execution |
| `--daemon` | Run scheduled missions continuously |
| `--once` | Run scheduled missions once, then exit |

## Examples

### Dry Run Mode

Validate your mission syntax without making actual API calls:

```bash
reqon sync-data.vague --dry-run
```

### Verbose Output

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

### Exporting Results

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

### Daemon Mode

Run scheduled missions continuously:

```bash
reqon ./missions/ --daemon
```

The daemon will:
- Parse all missions in the folder
- Execute scheduled missions according to their schedule
- Respect rate limits and backoff strategies
- Handle graceful shutdown on SIGINT/SIGTERM

### One-Shot Scheduled Execution

Run all scheduled missions once:

```bash
reqon ./missions/ --once
```

Useful for cron-triggered executions where you want external scheduling.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (HTTP failure, validation error, etc.) |
| 2 | Parse error (invalid syntax) |
| 3 | Configuration error (missing credentials, invalid options) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REQON_STATE_DIR` | Directory for execution state (default: `.vague-data`) |
| `REQON_LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, `error` |
| `REQON_DRY_RUN` | Enable dry-run mode (same as `--dry-run`) |

## Multi-File Missions

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

### Debugging HTTP Issues

Use verbose mode to see request/response details:

```bash
reqon mission.vague --verbose 2>&1 | tee debug.log
```
