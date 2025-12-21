---
sidebar_position: 4
---

# Daemon Mode

Daemon mode runs Reqon as a long-running service, executing scheduled missions automatically.

## Starting the Daemon

```bash
reqon ./missions/ --daemon
```

## How It Works

1. Daemon loads all missions from the specified path
2. Parses schedule configurations
3. Runs missions according to their schedules
4. Continues until stopped

## Command Options

```bash
reqon ./missions/ --daemon [options]

Options:
  --auth <file>        Credentials file
  --verbose            Enable detailed logging
  --check-interval     How often to check schedules (default: 1000ms)
```

## Example Setup

### Mission Files

```
missions/
├── sync-customers.reqon
├── sync-orders.reqon
└── daily-report.reqon
```

### sync-customers.reqon

```reqon
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

## Process Management

### Foreground

```bash
reqon ./missions/ --daemon
```

Press Ctrl+C to stop.

### Background (Linux)

```bash
nohup reqon ./missions/ --daemon > reqon.log 2>&1 &
```

### Systemd Service

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

## Graceful Shutdown

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

## Health Checks

### Status Endpoint

Enable HTTP health endpoint:

```bash
reqon ./missions/ --daemon --health-port 8080
```

Check health:

```bash
curl http://localhost:8080/health
# {"status":"ok","uptime":3600,"missionsLoaded":3}
```

### File-Based Health

```reqon
mission HealthCheck {
  schedule: every 1 minute

  action Check {
    store { status: "ok", timestamp: now() } -> health
  }
}
```

Monitor the health store file.

## Logging

### Log Levels

```bash
# Default logging
reqon ./missions/ --daemon

# Verbose logging
reqon ./missions/ --daemon --verbose

# Environment variable
REQON_LOG_LEVEL=debug reqon ./missions/ --daemon
```

### Log Output

```
[2024-01-20 09:00:00] [INFO] Starting Reqon daemon
[2024-01-20 09:00:00] [INFO] Loaded 3 missions
[2024-01-20 09:00:00] [INFO] SyncCustomers: Next run at 09:15:00
[2024-01-20 09:00:00] [INFO] SyncOrders: Next run at 09:05:00
[2024-01-20 09:00:00] [INFO] DailyReport: Next run at 2024-01-21 00:00:00
[2024-01-20 09:05:00] [INFO] SyncOrders: Starting run
[2024-01-20 09:05:02] [INFO] SyncOrders: Completed (2.1s)
```

### Structured Logging

```bash
REQON_LOG_FORMAT=json reqon ./missions/ --daemon
```

```json
{"timestamp":"2024-01-20T09:00:00Z","level":"info","message":"Starting run","mission":"SyncCustomers"}
```

## Monitoring

### Metrics

Export metrics with `--metrics-port`:

```bash
reqon ./missions/ --daemon --metrics-port 9090
```

Prometheus format:

```
# HELP reqon_mission_runs_total Total mission runs
reqon_mission_runs_total{mission="SyncCustomers",status="success"} 142
reqon_mission_runs_total{mission="SyncCustomers",status="failure"} 3

# HELP reqon_mission_duration_seconds Mission run duration
reqon_mission_duration_seconds{mission="SyncCustomers",quantile="0.5"} 2.1
```

### Alerting

Create alerting rules:

```yaml
groups:
  - name: reqon
    rules:
      - alert: ReqonMissionFailing
        expr: rate(reqon_mission_runs_total{status="failure"}[5m]) > 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Mission {{ $labels.mission }} is failing"
```

## Best Practices

### Use Separate Credentials

```bash
# Production credentials
reqon ./missions/ --daemon --auth ./prod-credentials.json
```

### Run as Non-Root

```bash
# Create dedicated user
useradd -r -s /bin/false reqon

# Run as that user
sudo -u reqon reqon ./missions/ --daemon
```

### Persistent Storage

Ensure `.reqon-data` is on persistent storage:

```yaml
volumes:
  - /var/lib/reqon:/app/.reqon-data
```

### Health Monitoring

Always enable health checks:

```bash
reqon ./missions/ --daemon --health-port 8080
```

### Log Rotation

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
