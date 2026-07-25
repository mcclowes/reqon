---
sidebar_position: 21
description: Programmatic API reference for Reqon - parse, execute, store adapters, executor config, progress callbacks, observability, and the MCP server.
keywords: [reqon, API, reference, execute, parse, store adapter, observability]
---

# API reference

Reqon's programmatic API for advanced usage. The package is published as `reqon-dsl`, so import from `'reqon-dsl'`.

```bash
npm install reqon-dsl
```

## Core functions

### parse

Parse a Reqon source string into an AST.

```typescript
import { parse } from 'reqon-dsl';

const program = parse(`
  mission Example {
    source API { auth: bearer, base: "https://api.example.com" }
    store data: file("data")
    action Fetch { get "/data" }
    run Fetch
  }
`);

console.log(program.statements.length); // 1
```

**Parameters:**
- `source: string` - Reqon source code
- `filePath?: string` - Optional file path, used for error messages

**Returns:** `ReqonProgram` - the parsed AST, with a `statements` array

### execute

Parse and execute a mission from source code.

```typescript
import { execute } from 'reqon-dsl';

const result = await execute(`
  mission Example {
    source API { auth: none, base: "https://jsonplaceholder.typicode.com" }
    store posts: memory("posts")
    action Fetch {
      get "/posts"
      store response -> posts { key: .id }
    }
    run Fetch
  }
`);

console.log(result.success); // true
console.log(result.duration); // 234
console.log(result.actionsRun); // ["Fetch"]
```

**Parameters:**
- `source: string` - Reqon source code
- `config?: ExecutorConfig` - optional configuration

**Returns:** `Promise<ExecutionResult>`

### fromFile

Execute a mission from a single file.

```typescript
import { fromFile } from 'reqon-dsl';

const result = await fromFile('./mission.vague', {
  auth: {
    API: { type: 'bearer', token: 'xxx' },
  },
});
```

**Parameters:**
- `filePath: string` - path to a `.vague` or `.reqon` file
- `config?: ExecutorConfig` - optional configuration

**Returns:** `Promise<ExecutionResult>`

### fromPath

Execute a mission from a file or a folder (multi-file mission). Use this when you want folder missions to resolve their action files automatically.

```typescript
import { fromPath } from 'reqon-dsl';

// Single file
const result1 = await fromPath('./mission.vague');

// Folder (multi-file mission)
const result2 = await fromPath('./missions/customer-sync/');
```

**Parameters:**
- `path: string` - path to a file or folder
- `config?: ExecutorConfig` - optional configuration

**Returns:** `Promise<ExecutionResult>`

### reqon (tagged template)

Parse an inline mission with a tagged template literal. It returns a `ReqonProgram`, the same as `parse`; there is no `program.execute()` method, so pass the source to `execute` to run it.

```typescript
import { reqon, MissionExecutor } from 'reqon-dsl';

const program = reqon`
  mission Example {
    source API { auth: bearer, base: "https://api.example.com" }
    store data: file("data")
    action Fetch { get "/data" }
    run Fetch
  }
`;

const result = await new MissionExecutor().execute(program);
```

## Configuration

### ExecutorConfig

These are the keys read by the executor. All are optional.

```typescript
interface ExecutorConfig {
  // Auth credentials by source name
  auth?: Record<string, AuthConfig>;
  // Custom store adapters by store name
  stores?: Record<string, StoreAdapter>;
  // Skip actual HTTP requests
  dryRun?: boolean;
  // Verbose logging
  verbose?: boolean;
  // Mission file directory (for resolving relative paths like OAS specs)
  missionDir?: string;
  // Use file stores when sql/nosql stores are declared (--dev mode)
  developmentMode?: boolean;
  // Base directory for file stores, sync, executions, traces (default: '.reqon-data')
  dataDir?: string;
  // Enable state persistence for resumable executions
  persistState?: boolean;
  // Resume from a previous execution ID
  resumeFrom?: string;
  // Progress callbacks for real-time UI updates
  progress?: ProgressCallbacks;
  // Webhook server for handling 'wait' steps
  webhookServer?: WebhookServer;
  // Control server for pause/resume and status queries
  controlServer?: ControlServer;
  // Append-only execution event log (durable-execution foundation)
  executionLog?: ExecutionLogStore;
}
```

There are further advanced keys (`metadata`, `executionStore`, `syncStore`, `traceStore`, `pauseStore`, `pauseManager`, `eventEmitter`, `logger`, `debugController`, `rateLimitCallbacks`, `circuitBreakerCallbacks`, `backfillMaxItemsPerRun`); see `ExecutorConfig` in `src/interpreter/executor.ts` for the full list.

### AuthConfig

Credentials passed programmatically. Only `bearer` and `oauth2` attach auth to outgoing requests at runtime.

```typescript
interface AuthConfig {
  type: 'bearer' | 'oauth2' | 'none';
  token?: string; // bearer
  accessToken?: string; // oauth2
  refreshToken?: string; // oauth2
  tokenEndpoint?: string; // oauth2
  clientId?: string; // oauth2
  clientSecret?: string; // oauth2
}
```

### ProgressCallbacks

```typescript
interface ProgressCallbacks {
  onExecutionStart?: (event: ExecutionStartEvent) => void;
  onExecutionComplete?: (event: ExecutionCompleteEvent) => void;
  onStageStart?: (event: StageStartEvent) => void;
  onStageComplete?: (event: StageCompleteEvent) => void;
}

interface ExecutionStartEvent {
  executionId: string;
  mission: string;
  stageCount: number;
  isResume: boolean;
  metadata?: Record<string, unknown>;
}

interface StageStartEvent {
  executionId: string;
  mission: string;
  stageIndex: number;
  stageName: string;
  totalStages: number;
}
```

`StageCompleteEvent` adds `success`, `duration`, and an optional `error`; `ExecutionCompleteEvent` reports `success`, `duration`, `stagesCompleted`, `stagesFailed`, and `errors`.

## Results

### ExecutionResult

```typescript
interface ExecutionResult {
  success: boolean;
  duration: number; // milliseconds
  actionsRun: string[];
  errors: ExecutionError[];
  stores: Map<string, StoreAdapter>;
  executionId?: string; // for resuming
  state?: ExecutionState; // when persistence is enabled
  traceId?: string; // when tracing is enabled
  pauseId?: string; // when execution paused
}
```

### ExecutionError

```typescript
interface ExecutionError {
  action: string;
  step: string;
  message: string;
  details?: unknown;
}
```

## Store adapters

### StoreAdapter interface

```typescript
interface StoreAdapter {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  bulkSet?(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void>;
  bulkUpsert?(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void>;
  update(key: string, value: Partial<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
  list(filter?: StoreFilter): Promise<Record<string, unknown>[]>;
  count(filter?: StoreFilter): Promise<number>;
  clear(): Promise<void>;
}

interface StoreFilter {
  where?: Record<string, unknown>; // equality match by field
  limit?: number;
  offset?: number;
}
```

`where` filters are equality-only.

### Built-in stores and createStore

Reqon exports `MemoryStore`, `FileStore`, `PostgRESTStore`, and a `createStore` factory.

```typescript
import { createStore, MemoryStore, FileStore } from 'reqon-dsl';

const mem = new MemoryStore('cache');
const file = new FileStore('output', { baseDir: '.reqon-data' });
```

### Using a custom store

There is no global store registry. To use your own adapter, implement `StoreAdapter` and pass it in `ExecutorConfig.stores`, keyed by the store name used in the mission.

```typescript
import { execute, type StoreAdapter } from 'reqon-dsl';

class MyStore implements StoreAdapter {
  /* ... */
}

await execute(source, {
  stores: { customers: new MyStore() },
});
```

## AST types

The full AST node set is exported from the package (`export * from './ast'`). The top-level shape is:

```typescript
interface ReqonProgram {
  statements: Statement[]; // mission definitions and other top-level statements
}

interface MissionDefinition {
  type: 'MissionDefinition';
  name: string;
  schedule?: ScheduleDefinition;
  checkpoint?: CheckpointConfig; // durable execution
  trace?: TraceConfig; // time-travel debugging
  sources: SourceDefinition[];
  stores: StoreDefinition[];
  schemas: SchemaDefinition[];
  transforms: TransformDefinition[];
  actions: ActionDefinition[];
  pipeline: PipelineDefinition;
}
```

## Error classes

```typescript
import {
  ReqonError,
  ParseError,
  LexerError,
  RuntimeError,
  ValidationError,
} from 'reqon-dsl';

try {
  await execute(source);
} catch (error) {
  if (error instanceof ParseError) {
    console.error(error.format());
  } else if (error instanceof ValidationError) {
    console.error(`Validation failed: ${error.message}`);
  }
}
```

`ReqonError` is the base class; all of the above extend it and provide a `format()` method that renders source context.

## Observability

### createStructuredLogger

Create a structured logger with console and/or JSON-lines output.

```typescript
import { createStructuredLogger } from 'reqon-dsl';

const logger = createStructuredLogger({
  prefix: 'MyApp',
  level: 'info',
  console: true,
  jsonLines: true,
  context: { service: 'data-sync' },
});

logger.info('Starting sync', { count: 100 });
const span = logger.span('fetchData');
// ... do work
span.end();
```

### createEmitter

Create an event emitter for observability. It takes an execution ID and a mission name.

```typescript
import { createEmitter } from 'reqon-dsl';

const emitter = createEmitter('exec-123', 'CustomerSync');

emitter.on('fetch.complete', (event) => {
  console.log('fetch complete', event);
});

emitter.on('mission.complete', (event) => {
  console.log('mission complete', event);
});
```

### OTLPExporter

Export traces to an OpenTelemetry collector.

```typescript
import { OTLPExporter, createOTelListener } from 'reqon-dsl';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon-pipeline',
});

const listener = createOTelListener(exporter);
```

### Event types

```typescript
type EventType =
  | 'mission.start' | 'mission.complete' | 'mission.failed' | 'mission.paused'
  | 'stage.start' | 'stage.complete'
  | 'step.start' | 'step.complete'
  | 'fetch.start' | 'fetch.complete' | 'fetch.retry' | 'fetch.error' | 'fetch.heartbeat'
  | 'data.transform' | 'data.validate' | 'data.store'
  | 'loop.start' | 'loop.iteration' | 'loop.complete' | 'loop.heartbeat'
  | 'match.attempt' | 'match.result'
  | 'webhook.register' | 'webhook.event' | 'webhook.complete'
  | 'checkpoint.save' | 'checkpoint.resume'
  | 'sync.checkpoint'
  | 'ratelimit.wait' | 'ratelimit.resume'
  | 'circuit.open' | 'circuit.halfopen' | 'circuit.close';
```

## MCP server

Reqon ships an MCP server, exposed as the `reqon-mcp` binary.

```typescript
import { spawn } from 'node:child_process';
spawn('npx', ['reqon-mcp', '--verbose']);
```

### MCP tools

| Tool | Description |
|------|-------------|
| `reqon.execute` | Execute a mission from source |
| `reqon.execute_file` | Execute a mission from a file |
| `reqon.parse` | Parse and validate source |
| `reqon.query_store` | Query store data |
| `reqon.list_stores` | List stores |
| `reqon.register_store` | Register a store |

## Plugin system

Reqon registers itself as a Vague plugin on import. The exported helpers are `reqonPlugin` and `registerReqonPlugin`.

```typescript
import { reqonPlugin, registerReqonPlugin } from 'reqon-dsl';
```

For expression syntax, pattern matching, and schema definitions, see the [Vague documentation](https://github.com/mcclowes/vague). For the authoritative export list, see the [source code](https://github.com/mcclowes/reqon).
