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
import { execute, createStructuredLogger } from 'reqon-dsl';

const logger = createStructuredLogger({
  prefix: 'MyApp',
  level: 'debug',
  console: true
});

const result = await execute(source, {
  logger
});
```

### Event listeners

`createEmitter` takes an execution ID and a mission name. Each handler receives an event whose data lives on `event.payload`:

```typescript
import { execute, createEmitter } from 'reqon-dsl';

const emitter = createEmitter('my-run', 'SyncCustomers');

emitter.on('fetch.complete', (event) => {
  console.log(`Fetched ${event.payload.path}: ${event.payload.recordCount} records`);
});

emitter.on('data.store', (event) => {
  console.log(`Stored ${event.payload.itemCount} items to ${event.payload.storeName}`);
});

const result = await execute(source, {
  eventEmitter: emitter
});
```

### OpenTelemetry export

`createOTelListener` takes an OTLP config and returns a `handler` you subscribe to the emitter, plus a `flush`:

```typescript
import { execute, createEmitter, createOTelListener } from 'reqon-dsl';

const otel = createOTelListener({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon-sync'
});

const emitter = createEmitter('my-run', 'SyncCustomers');
emitter.onAll(otel.handler);

await execute(source, { eventEmitter: emitter });
await otel.flush();
```

## Event types

Reqon emits events for every significant operation:

| Category | Events |
|----------|--------|
| **Mission** | `mission.start`, `mission.complete`, `mission.failed`, `mission.paused` |
| **Stage** | `stage.start`, `stage.complete` |
| **Step** | `step.start`, `step.complete` |
| **HTTP** | `fetch.start`, `fetch.complete`, `fetch.retry`, `fetch.error`, `fetch.heartbeat` |
| **Data** | `data.transform`, `data.validate`, `data.store` |
| **Loops** | `loop.start`, `loop.iteration`, `loop.complete`, `loop.heartbeat` |
| **Match** | `match.attempt`, `match.result` |
| **Webhook** | `webhook.register`, `webhook.event`, `webhook.complete` |
| **State** | `checkpoint.save`, `checkpoint.resume`, `sync.checkpoint` |
| **Resilience** | `ratelimit.wait`, `ratelimit.resume`, `circuit.open`, `circuit.halfopen`, `circuit.close` |

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
const emitter = createEmitter('debug-run', 'SyncCustomers');

emitter.on('fetch.error', (event) => {
  console.error(`Failed: ${event.payload.path}`, event.payload.error);
});
```

### Performance monitoring

```typescript
const metrics = {
  fetchCount: 0,
  recordsFetched: 0,
  errors: 0
};

emitter.on('fetch.complete', (event) => {
  metrics.fetchCount++;
  metrics.recordsFetched += event.payload.recordCount;
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
    store: event.payload.storeName,
    count: event.payload.itemCount,
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

Set the log level and outputs when you create the logger, and configure the OTLP endpoint when you create the listener. Reqon doesn't read observability settings from environment variables.

## Next steps

- [Structured Logging](./structured-logging) - Deep dive into logging APIs
- [OpenTelemetry](./opentelemetry) - Distributed tracing setup
