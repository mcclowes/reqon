---
sidebar_position: 3
---

# OpenTelemetry integration

Reqon can convert its observability events into OpenTelemetry spans and export them over OTLP to backends like Jaeger, Grafana Tempo, and cloud providers.

This is a lightweight implementation that builds and posts OTLP-shaped spans directly. It doesn't depend on the official OpenTelemetry SDK.

## Overview

The integration:

- Turns Reqon events into OTel spans (mission, stage, step, and fetch spans).
- Builds a span hierarchy from the event stream.
- Exports spans over OTLP via HTTP.

## Quick start

`createOTelListener` takes an OTLP config and returns an `adapter`, a `handler` to subscribe to the event emitter, and a `flush` to send the spans:

```typescript
import { execute, createEmitter, createOTelListener } from 'reqon';

const otel = createOTelListener({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon-sync'
});

const emitter = createEmitter('my-run', 'SyncCustomers');
emitter.onAll(otel.handler);

await execute(source, { eventEmitter: emitter });

// Send the collected spans
await otel.flush();
```

## OTLP exporter

If you want to manage spans yourself, use `OTLPExporter` directly.

### Configuration

```typescript
import { OTLPExporter } from 'reqon';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'data-pipeline',
  headers: {
    'Authorization': 'Bearer token'
  }
});
```

The config accepts `endpoint`, `serviceName`, and `headers`.

### Methods

```typescript
exporter.addSpans(spans);        // queue spans for export
await exporter.flush();          // POST queued spans to the endpoint
exporter.startAutoFlush(5000);   // flush every 5s
exporter.stopAutoFlush();
```

### Cloud provider endpoints

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
```

## Event adapter

`createOTelListener` wraps an `OTelEventAdapter`. You can also drive the adapter yourself. It exposes a single `processEvent` method that builds and closes spans as events arrive:

```typescript
import { createEmitter, OTelEventAdapter, OTLPExporter } from 'reqon';

const adapter = new OTelEventAdapter();
const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces'
});

const emitter = createEmitter('my-run', 'SyncCustomers');
emitter.onAll((event) => adapter.processEvent(event));

// ... run the mission ...

exporter.addSpans(adapter.getSpans());
await exporter.flush();
```

## Span builder

For custom instrumentation, `SpanBuilder` tracks spans by ID:

```typescript
import { SpanBuilder } from 'reqon';

const builder = new SpanBuilder();

const spanId = builder.startSpan('mission.sync', {
  kind: 'INTERNAL',
  attributes: {
    'reqon.mission': 'SyncCustomers'
  }
});

// ... do work ...

builder.endSpan(spanId, { status: 'OK' });

const spans = builder.getSpans();
```

### Span events

```typescript
const spanId = builder.startSpan('process.batch');
builder.addEvent(spanId, 'batch.progress', { processed: 50 });
builder.endSpan(spanId, { status: 'OK' });
```

Span status codes are `'UNSET'`, `'OK'`, or `'ERROR'`.

## Trace hierarchy

The adapter nests spans to mirror the pipeline:

```
mission:SyncCustomers (root)
├── stage:FetchCustomers
│   ├── step:fetch
│   └── step:store
└── stage:Export
    └── step:store
```

## Span attributes

The adapter sets these attributes:

| Attribute | Description |
|-----------|-------------|
| `service.name` | Service identifier (from the exporter config) |
| `reqon.execution_id` | Execution ID |
| `reqon.mission` | Mission name |
| `reqon.stage.name` | Stage name |
| `reqon.stage.index` | Stage index |
| `reqon.step.type` | Step type (`fetch`, `store`, `map`, …) |
| `reqon.step.index` | Step index within the action |
| `reqon.action` | Action name |
| `reqon.source` | Source name (on fetch spans) |
| `http.method` | HTTP method |
| `http.url` | Request path |
| `http.status_code` | Response status code |

## Viewing traces

### Jaeger

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

```typescript
const otel = createOTelListener({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon'
});
```

View traces at http://localhost:16686.

### Grafana Tempo

```typescript
const otel = createOTelListener({
  endpoint: 'http://tempo:4318/v1/traces',
  serviceName: 'reqon'
});
```

## Complete example

```typescript
import { execute, createEmitter, createOTelListener } from 'reqon';

const otel = createOTelListener({
  endpoint: process.env.OTEL_ENDPOINT || 'http://localhost:4318/v1/traces',
  serviceName: 'data-sync-pipeline'
});

const emitter = createEmitter('sync-run', 'SyncCustomers');
emitter.onAll(otel.handler);

const result = await execute(missionSource, {
  eventEmitter: emitter,
  verbose: true
});

// Flush the collected spans
await otel.flush();
```

## Best practices

### Always flush

Spans are queued in memory and only sent on `flush` (or by `startAutoFlush`). Call `flush` before the process exits, or you'll lose spans.

### Sampling

For high-volume pipelines, decide per run whether to attach the OTel listener:

```typescript
const shouldSample = Math.random() < 0.1; // 10%
if (shouldSample) {
  emitter.onAll(otel.handler);
}
```
</content>
