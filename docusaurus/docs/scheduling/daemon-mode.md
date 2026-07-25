---
sidebar_position: 4
---

# Daemon mode

Daemon mode runs Reqon as a long-running service, executing scheduled missions automatically.

## Starting the daemon

```bash
reqon ./missions/ --daemon
```

## How it works

1. Daemon loads all missions from the specified path
2. Parses schedule configurations
3. Runs missions according to their schedules
4. Continues until stopped

## Command options

```bash
reqon ./missions/ --daemon [options]

Options:
  --auth <file>        Credentials file
  --env <file>         Path to .env file
  --verbose            Enable detailed logging
  --dry-run            Run without making actual HTTP requests
  --once               Run every scheduled mission once, then exit
  --control            Enable the control server for status and pause/resume
  --control-port <n>   Port for the control server (default: 3001)
```

## Example setup

### Mission files

```
missions/
├── sync-customers.vague
├── sync-orders.vague
└── daily-report.vague
```

### sync-customers.vague

```vague
mission SyncCustomers {
  schedule: every 15 minutes

  source API { auth: bearer, base: "https://api.example.com" }
  store customers: file("customers")

  action Sync {
    get "/customers" { since: lastSync }
    store response -> customers { key: .id, upsert: true }
  }

  run Sync
}
```

### Running

```bash
reqon ./missions/ --daemon --auth ./credentials.json --verbose
```

## Process management

### Foreground

```bash
reqon ./missions/ --daemon
```

Press Ctrl+C to stop.

### Background (Linux)

```bash
nohup reqon ./missions/ --daemon > reqon.log 2>&1 &
```

### Systemd service

Create `/etc/systemd/system/reqon.service`:

```ini
[Unit]
Description=Reqon Data Sync Daemon
After=network.target

[Service]
Type=simple
User=reqon
WorkingDirectory=/opt/reqon
ExecStart=/usr/bin/npx reqon ./missions/ --daemon --auth ./credentials.json
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable reqon
sudo systemctl start reqon
```

### Docker

Dockerfile:

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

CMD ["npx", "reqon", "./missions/", "--daemon"]
```

docker-compose.yml:

```yaml
version: '3'
services:
  reqon:
    build: .
    volumes:
      - ./missions:/app/missions
      - ./credentials.json:/app/credentials.json
      - reqon-data:/app/.reqon-data
    environment:
      - NODE_ENV=production
    restart: unless-stopped

volumes:
  reqon-data:
```

## Graceful shutdown

Reqon handles SIGINT and SIGTERM:

1. Stops accepting new runs
2. Waits for in-progress missions to complete
3. Saves state
4. Exits cleanly

```bash
# Graceful stop
kill -TERM $(pgrep -f "reqon.*daemon")

# Or with systemd
systemctl stop reqon
```

## Health checks

### Control server

Enable the control server to expose status and health endpoints:

```bash
reqon ./missions/ --daemon --control --control-port 3001
```

The server exposes:

```bash
curl http://localhost:3001/health   # Health check
curl http://localhost:3001/status   # Current execution state and progress
```

It also accepts `POST /pause` to request a graceful pause at the next safe point and `POST /resume` to clear that request.

### File-based health

```vague
mission HealthCheck {
  schedule: every 1 minutes

  action Check {
    store { status: "ok", timestamp: now() } -> health
  }
}
```

Monitor the health store file.

## Logging

The daemon logs to stdout. Use `--verbose` for detailed output; there's no log-level or log-format environment variable.

```bash
# Default logging
reqon ./missions/ --daemon

# Verbose logging
reqon ./missions/ --daemon --verbose
```

### Log output

```
Found 3 scheduled mission(s)

Scheduled jobs:
  - SyncCustomers: every 15 minutes
    Next run: 2024-01-20T09:15:00.000Z
  - SyncOrders: cron "*/5 * * * *"
    Next run: 2024-01-20T09:05:00.000Z

Starting scheduler daemon (Ctrl+C to stop)...

[2024-01-20 09:05:00] Starting: SyncOrders
[2024-01-20 09:05:02] Completed: SyncOrders (2100ms)
```

## Best practices

### Use separate credentials

```bash
# Production credentials
reqon ./missions/ --daemon --auth ./prod-credentials.json
```

### Run as non-root

```bash
# Create dedicated user
useradd -r -s /bin/false reqon

# Run as that user
sudo -u reqon reqon ./missions/ --daemon
```

### Persistent storage

Ensure `.reqon-data` is on persistent storage:

```yaml
volumes:
  - /var/lib/reqon:/app/.reqon-data
```

### Health monitoring

Enable the control server so you can poll status and health:

```bash
reqon ./missions/ --daemon --control --control-port 3001
```

### Log rotation

```bash
# Use logrotate
/var/log/reqon/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```
