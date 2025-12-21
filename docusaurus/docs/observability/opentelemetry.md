---
sidebar_position: 3
---

# OpenTelemetry Integration

Reqon supports OpenTelemetry for distributed tracing, allowing you to export spans to observability platforms like Jaeger, Zipkin, Grafana Tempo, and cloud providers.

## Overview

The OpenTelemetry integration:

- Converts Reqon events to OTel spans
- Supports hierarchical trace contexts
- Exports via OTLP (OpenTelemetry Protocol)
- Provides span builders for custom instrumentation

## Quick Start

```typescript
import { execute, OTLPExporter, createOTelListener } from 'reqon';

// Create OTLP exporter
const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon-sync'
});

// Create event listener that exports to OTel
const otelListener = createOTelListener(exporter);

// Execute with tracing
const result = await execute(source, {
  eventEmitter: otelListener
});
```

## OTLP Exporter

### Configuration

```typescript
import { OTLPExporter } from 'reqon';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'data-pipeline',
  serviceVersion: '1.0.0',
  headers: {
    'Authorization': 'Bearer token'
  },
  timeout: 5000  // ms
});
```

### Cloud Provider Endpoints

```typescript
// Grafana Cloud
const grafanaExporter = new OTLPExporter({
  endpoint: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces',
  headers: {
    'Authorization': `Basic ${Buffer.from(`${instanceId}:${token}`).toString('base64')}`
  }
});

// Honeycomb
const honeycombExporter = new OTLPExporter({
  endpoint: 'https://api.honeycomb.io/v1/traces',
  headers: {
    'x-honeycomb-team': 'your-api-key'
  }
});

// Datadog
const datadogExporter = new OTLPExporter({
  endpoint: 'https://trace.agent.datadoghq.com/v1/traces',
  headers: {
    'DD-API-KEY': 'your-api-key'
  }
});
```

## Span Builder

Create custom spans with the SpanBuilder:

```typescript
import { SpanBuilder, generateTraceId, generateSpanId } from 'reqon';

const traceId = generateTraceId();

const missionSpan = new SpanBuilder('mission.sync')
  .setTraceId(traceId)
  .setSpanId(generateSpanId())
  .setAttribute('mission.name', 'SyncCustomers')
  .setAttribute('mission.version', '1.0')
  .setStartTime(Date.now())
  .build();

// Later...
missionSpan.endTimeUnixNano = Date.now() * 1_000_000;
missionSpan.status = { code: 1 }; // OK
```

### Span Attributes

```typescript
const span = new SpanBuilder('fetch.customers')
  .setAttribute('http.method', 'GET')
  .setAttribute('http.url', '/api/customers')
  .setAttribute('http.status_code', 200)
  .setAttribute('http.response_content_length', 1024)
  .build();
```

### Span Events

```typescript
const span = new SpanBuilder('process.batch')
  .addEvent('batch.start', { batchSize: 100 })
  .addEvent('batch.progress', { processed: 50 })
  .addEvent('batch.complete', { processed: 100 })
  .build();
```

## OTel Event Adapter

The OTelEventAdapter converts Reqon events to OTel spans:

```typescript
import { OTelEventAdapter, OTLPExporter, createEmitter } from 'reqon';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces'
});

const adapter = new OTelEventAdapter(exporter, {
  serviceName: 'reqon-pipeline'
});

const emitter = createEmitter();

// Subscribe to all events
emitter.on('mission.start', (e) => adapter.onMissionStart(e));
emitter.on('mission.complete', (e) => adapter.onMissionComplete(e));
emitter.on('fetch.start', (e) => adapter.onFetchStart(e));
emitter.on('fetch.complete', (e) => adapter.onFetchComplete(e));
// ... etc
```

## OTel Log Output

Send structured logs as OTel spans:

```typescript
import { createStructuredLogger, OTelLogOutput, OTLPExporter } from 'reqon';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces'
});

const logger = createStructuredLogger({
  console: true
});

logger.addOutput(new OTelLogOutput(exporter));
```

## Trace Context

### Trace Hierarchy

```
Mission (root span)
├── Action: FetchCustomers
│   ├── Step: fetch GET /customers
│   ├── Step: validate
│   └── Step: store -> customers
├── Action: EnrichCustomers
│   ├── Step: for customer in customers
│   │   ├── fetch GET /customers/{id}/details
│   │   └── store -> enriched
│   └── Step: validate
└── Action: Export
    └── Step: store -> file
```

### Propagation

```typescript
import { generateTraceId, generateSpanId } from 'reqon';

// Generate trace context
const traceId = generateTraceId();  // 32-char hex
const spanId = generateSpanId();    // 16-char hex

// Include in outgoing requests
const headers = {
  'traceparent': `00-${traceId}-${spanId}-01`
};
```

## Viewing Traces

### Jaeger

Run Jaeger locally:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Configure exporter:

```typescript
const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon'
});
```

View at: http://localhost:16686

### Grafana Tempo

```typescript
const exporter = new OTLPExporter({
  endpoint: 'http://tempo:4318/v1/traces',
  serviceName: 'reqon'
});
```

## Complete Example

```typescript
import {
  execute,
  createEmitter,
  OTLPExporter,
  OTelEventAdapter,
  createStructuredLogger,
  OTelLogOutput
} from 'reqon';

// Setup exporter
const exporter = new OTLPExporter({
  endpoint: process.env.OTEL_ENDPOINT || 'http://localhost:4318/v1/traces',
  serviceName: 'data-sync-pipeline',
  serviceVersion: '2.0.0'
});

// Setup event adapter
const otelAdapter = new OTelEventAdapter(exporter, {
  serviceName: 'data-sync-pipeline',
  includeContext: true
});

// Setup emitter with OTel subscriptions
const emitter = createEmitter();
emitter.on('mission.start', (e) => otelAdapter.onMissionStart(e));
emitter.on('mission.complete', (e) => otelAdapter.onMissionComplete(e));
emitter.on('mission.failed', (e) => otelAdapter.onMissionFailed(e));
emitter.on('fetch.start', (e) => otelAdapter.onFetchStart(e));
emitter.on('fetch.complete', (e) => otelAdapter.onFetchComplete(e));
emitter.on('fetch.error', (e) => otelAdapter.onFetchError(e));
emitter.on('data.store', (e) => otelAdapter.onDataStore(e));

// Setup logger with OTel output
const logger = createStructuredLogger({
  level: 'info',
  console: true
});
logger.addOutput(new OTelLogOutput(exporter));

// Execute
const result = await execute(missionSource, {
  eventEmitter: emitter,
  verbose: true
});

// Flush remaining spans
await exporter.flush();
```

## Semantic Conventions

Reqon follows OpenTelemetry semantic conventions:

| Attribute | Description |
|-----------|-------------|
| `service.name` | Service identifier |
| `service.version` | Service version |
| `http.method` | HTTP method (GET, POST, etc.) |
| `http.url` | Request URL |
| `http.status_code` | Response status code |
| `http.response_content_length` | Response body size |
| `reqon.mission.name` | Mission name |
| `reqon.action.name` | Action name |
| `reqon.store.name` | Store name |
| `reqon.store.count` | Items stored |

## Best Practices

### Sampling

For high-volume pipelines, implement sampling:

```typescript
const shouldSample = () => Math.random() < 0.1; // 10% sampling

if (shouldSample()) {
  const exporter = new OTLPExporter({ ... });
  // Use exporter
}
```

### Error Recording

```typescript
emitter.on('fetch.error', (event) => {
  const span = new SpanBuilder('fetch.error')
    .setAttribute('error', true)
    .setAttribute('error.message', event.error)
    .setAttribute('http.url', event.url)
    .addEvent('exception', {
      'exception.message': event.error
    })
    .build();

  span.status = { code: 2, message: event.error }; // ERROR
  exporter.export([span]);
});
```

### Resource Attributes

```typescript
const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon',
  resourceAttributes: {
    'deployment.environment': 'production',
    'host.name': os.hostname(),
    'process.pid': process.pid
  }
});
```
