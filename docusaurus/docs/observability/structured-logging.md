---
sidebar_position: 2
---

# Structured Logging

Reqon's structured logging system provides context-rich logs with hierarchical spans, multiple output formats, and integration with the event system.

## Creating a Logger

```typescript
import { createStructuredLogger } from 'reqon';

const logger = createStructuredLogger({
  prefix: 'MyApp',     // Log prefix
  level: 'info',       // Minimum log level
  console: true,       // Enable console output
  jsonLines: false,    // Enable JSON lines output
  context: {           // Default context
    service: 'data-sync'
  }
});
```

## Log Levels

```typescript
logger.debug('Detailed debugging info', { key: 'value' });
logger.info('General information', { count: 42 });
logger.warn('Warning condition', { threshold: 100 });
logger.error('Error occurred', { error: err.message });
```

### Level Filtering

```typescript
const logger = createStructuredLogger({ level: 'warn' });

logger.debug('Not logged');  // Filtered out
logger.info('Not logged');   // Filtered out
logger.warn('Logged');       // Output
logger.error('Logged');      // Output

// Change level at runtime
logger.setLevel('debug');
```

## Context

### Adding Context

```typescript
logger.info('Processing item', {
  itemId: item.id,
  itemType: item.type,
  size: item.size
});
```

Output:
```
[MyApp] INFO  Processing item itemId="123" itemType="order" size=42
```

### Child Loggers

Create child loggers with inherited context:

```typescript
const logger = createStructuredLogger({ prefix: 'App' });

const actionLogger = logger.child({ action: 'FetchCustomers' });
actionLogger.info('Starting');
// [App] INFO Starting action="FetchCustomers"

const stepLogger = actionLogger.child({ step: 1 });
stepLogger.info('Fetching page');
// [App] INFO Fetching page action="FetchCustomers" step=1
```

## Timing Spans

Track operation duration with spans:

```typescript
const span = logger.span('fetchData');

try {
  const data = await fetchData();
  span.addContext({ itemCount: data.length });
} finally {
  const duration = span.end();
  // [App] DEBUG span:end spanName="fetchData" itemCount=100 (234ms)
}
```

### Nested Spans

```typescript
const missionSpan = logger.span('mission');

const fetchSpan = missionSpan.child('fetch');
await fetch('/api/data');
fetchSpan.end();

const processSpan = missionSpan.child('process');
await processData();
processSpan.end();

missionSpan.end();
```

## Output Handlers

### ConsoleOutput

Human-readable console output:

```typescript
import { ConsoleOutput } from 'reqon';

const output = new ConsoleOutput({
  prefix: 'Reqon',
  colors: true
});

logger.addOutput(output);
```

### JsonLinesOutput

JSON lines format for log aggregation:

```typescript
import { JsonLinesOutput } from 'reqon';
import { createWriteStream } from 'fs';

const stream = createWriteStream('logs.jsonl');
const output = new JsonLinesOutput(stream);

logger.addOutput(output);
```

Output format:
```json
{"level":"info","message":"Processing","timestamp":"2025-01-20T10:00:00Z","context":{"itemId":"123"}}
```

### BufferOutput

For testing and inspection:

```typescript
import { BufferOutput } from 'reqon';

const buffer = new BufferOutput();
logger.addOutput(buffer);

// Later
const errors = buffer.filter(e => e.level === 'error');
const hasWarnings = buffer.find(e => e.level === 'warn') !== undefined;
buffer.clear();
```

### EventOutput

Bridge logs to the event system:

```typescript
import { EventOutput, createEmitter } from 'reqon';

const emitter = createEmitter();
const output = new EventOutput(emitter);

logger.addOutput(output);
```

## Multiple Outputs

Configure multiple outputs simultaneously:

```typescript
import {
  createStructuredLogger,
  ConsoleOutput,
  JsonLinesOutput
} from 'reqon';

const logger = createStructuredLogger({
  console: false,  // Disable default console
  silent: false
});

// Add custom outputs
logger.addOutput(new ConsoleOutput({ prefix: 'App' }));
logger.addOutput(new JsonLinesOutput(logStream));
```

## Log Entry Structure

```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;        // ISO 8601
  context: Record<string, unknown>;
  spanId?: string;          // For span entries
  parentSpanId?: string;    // For nested spans
  duration?: number;        // For span:end entries
}
```

## Best Practices

### Use Consistent Context Keys

```typescript
// Good: consistent naming
logger.info('Fetching', { userId: user.id, orderId: order.id });
logger.info('Processing', { userId: user.id, orderId: order.id });

// Avoid: inconsistent naming
logger.info('Fetching', { user_id: user.id });
logger.info('Processing', { uid: user.id });
```

### Log at Appropriate Levels

```typescript
// DEBUG: Detailed information for debugging
logger.debug('Parsed response', { fields: Object.keys(data) });

// INFO: General operational information
logger.info('Synced customers', { count: 150 });

// WARN: Unusual but handled conditions
logger.warn('Rate limited, waiting', { retryAfter: 60 });

// ERROR: Errors requiring attention
logger.error('Failed to connect', { error: err.message });
```

### Include Actionable Context

```typescript
// Good: includes context for debugging
logger.error('Failed to store item', {
  store: 'customers',
  itemId: item.id,
  error: err.message,
  retryCount: 3
});

// Poor: missing context
logger.error('Failed');
```

### Use Spans for Performance

```typescript
const span = logger.span('syncCustomers');

for (const customer of customers) {
  const itemSpan = span.child('processCustomer');
  await processCustomer(customer);
  itemSpan.end();
}

const duration = span.end();
if (duration > 5000) {
  logger.warn('Slow sync detected', { duration });
}
```

## Integration with Execution

```typescript
import { execute, createStructuredLogger, createEmitter } from 'reqon';

const emitter = createEmitter();
const logger = createStructuredLogger({
  eventEmitter: emitter,
  level: 'debug'
});

// Events flow to logger
emitter.on('fetch.complete', (event) => {
  logger.info('Fetch complete', {
    url: event.url,
    status: event.status,
    duration: event.duration
  });
});

await execute(source, { eventEmitter: emitter });
```
