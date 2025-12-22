---
sidebar_position: 1
---

# Observability overview

Reqon provides comprehensive observability features for monitoring and debugging mission execution. The observability system includes:

- **Structured Logging** - Context-rich logs with multiple output formats
- **Event System** - Fine-grained events for every pipeline operation
- **OpenTelemetry Integration** - Distributed tracing and OTLP export

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Mission Execution                      │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ Fetch   │  │  Map    │  │Validate │  │  Store  │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │
│       │            │            │            │         │
│       └────────────┴────────────┴────────────┘         │
│                         │                               │
│                    Event Emitter                        │
└─────────────────────────┬───────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         ▼                ▼                ▼
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Console │     │JSON Lines│     │  OTLP   │
    │ Output  │     │  Output │     │Exporter │
    └─────────┘     └─────────┘     └─────────┘
```

## Quick start

### Basic logging

```typescript
import { execute, createStructuredLogger, ConsoleOutput } from 'reqon';

const logger = createStructuredLogger({
  prefix: 'MyApp',
  level: 'debug',
  console: true
});

const result = await execute(source, {
  verbose: true
});
```

### Event listeners

```typescript
import { execute, createEmitter } from 'reqon';

const emitter = createEmitter();

emitter.on('fetch.complete', (event) => {
  console.log(`Fetched ${event.url} in ${event.duration}ms`);
});

emitter.on('data.store', (event) => {
  console.log(`Stored ${event.count} items to ${event.store}`);
});

const result = await execute(source, {
  eventEmitter: emitter
});
```

### OpenTelemetry export

```typescript
import { execute, OTLPExporter, createOTelListener } from 'reqon';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces'
});

const otelListener = createOTelListener(exporter);

const result = await execute(source, {
  eventEmitter: otelListener
});
```

## Event types

Reqon emits events for every significant operation:

| Category | Events |
|----------|--------|
| **Mission** | `mission.start`, `mission.complete`, `mission.failed` |
| **Stage** | `stage.start`, `stage.complete` |
| **Step** | `step.start`, `step.complete` |
| **HTTP** | `fetch.start`, `fetch.complete`, `fetch.retry`, `fetch.error` |
| **Data** | `data.transform`, `data.validate`, `data.store` |
| **Loops** | `loop.start`, `loop.iteration`, `loop.complete` |
| **Match** | `match.attempt`, `match.result` |
| **Webhook** | `webhook.register`, `webhook.event`, `webhook.complete` |
| **State** | `checkpoint.save`, `checkpoint.resume`, `sync.checkpoint` |
| **Resilience** | `ratelimit.hit`, `circuitbreaker.state` |

## Output formats

### Console output

Human-readable logs for development:

```
[Reqon] INFO  mission.start mission="SyncCustomers"
[Reqon] DEBUG fetch.start url="/customers" method="GET"
[Reqon] INFO  fetch.complete url="/customers" status=200 duration=234ms
[Reqon] INFO  data.store store="customers" count=50
[Reqon] INFO  mission.complete mission="SyncCustomers" duration=1234ms
```

### JSON lines

Machine-readable logs for log aggregation:

```json
{"level":"info","message":"mission.start","timestamp":"2025-01-20T10:00:00Z","context":{"mission":"SyncCustomers"}}
{"level":"debug","message":"fetch.start","timestamp":"2025-01-20T10:00:01Z","context":{"url":"/customers","method":"GET"}}
{"level":"info","message":"fetch.complete","timestamp":"2025-01-20T10:00:02Z","context":{"url":"/customers","status":200,"duration":234}}
```

### OpenTelemetry

Export spans to observability platforms:

- Jaeger
- Zipkin
- Grafana Tempo
- AWS X-Ray
- Datadog
- Honeycomb

## Use cases

### Debugging pipelines

```typescript
const emitter = createEmitter();

emitter.on('fetch.error', (event) => {
  console.error(`Failed: ${event.url}`, event.error);
});

emitter.on('data.validate', (event) => {
  if (!event.valid) {
    console.warn(`Validation failed: ${event.errors.join(', ')}`);
  }
});
```

### Performance monitoring

```typescript
const metrics = {
  fetchCount: 0,
  totalDuration: 0,
  errors: 0
};

emitter.on('fetch.complete', (event) => {
  metrics.fetchCount++;
  metrics.totalDuration += event.duration;
});

emitter.on('fetch.error', () => {
  metrics.errors++;
});
```

### Audit logging

```typescript
emitter.on('data.store', (event) => {
  auditLog.write({
    action: 'store',
    store: event.store,
    count: event.count,
    timestamp: new Date()
  });
});
```

## Configuration

### Log levels

| Level | Description |
|-------|-------------|
| `debug` | Detailed debugging information |
| `info` | General operational information |
| `warn` | Warning conditions |
| `error` | Error conditions |

### Environment variables

| Variable | Description |
|----------|-------------|
| `REQON_LOG_LEVEL` | Minimum log level |
| `REQON_OTEL_ENDPOINT` | OTLP exporter endpoint |
| `REQON_OTEL_SERVICE` | Service name for traces |

## Next steps

- [Structured Logging](./structured-logging) - Deep dive into logging APIs
- [OpenTelemetry](./opentelemetry) - Distributed tracing setup
