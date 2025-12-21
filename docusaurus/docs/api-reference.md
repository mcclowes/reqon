---
sidebar_position: 21
---

# API Reference

Reqon's programmatic API for advanced usage.

## Core Functions

### parse

Parse a Reqon source string into an AST.

```typescript
import { parse } from 'reqon';

const ast = parse(`
  mission Example {
    source API { auth: bearer, base: "https://api.example.com" }
    store data: file("data")
    action Fetch { get "/data" }
    run Fetch
  }
`);

console.log(ast.missions[0].name); // "Example"
```

**Parameters:**
- `source: string` - Reqon source code

**Returns:** `ReqonProgram` - The parsed AST

### execute

Execute a Reqon mission from source code.

```typescript
import { execute } from 'reqon';

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
- `config?: ExecutorConfig` - Optional configuration

**Returns:** `Promise<ExecutionResult>`

### fromFile

Execute a mission from a file.

```typescript
import { fromFile } from 'reqon';

const result = await fromFile('./mission.vague', {
  auth: {
    API: { type: 'bearer', token: 'xxx' }
  }
});
```

**Parameters:**
- `filePath: string` - Path to .vague file
- `config?: ExecutorConfig` - Optional configuration

**Returns:** `Promise<ExecutionResult>`

### fromPath

Execute a mission from a file or folder.

```typescript
import { fromPath } from 'reqon';

// Single file
const result1 = await fromPath('./mission.vague');

// Folder (multi-file mission)
const result2 = await fromPath('./missions/customer-sync/');
```

**Parameters:**
- `path: string` - Path to file or folder
- `config?: ExecutorConfig` - Optional configuration

**Returns:** `Promise<ExecutionResult>`

### reqon (Tagged Template)

Create a parsed program using a tagged template literal.

```typescript
import { reqon } from 'reqon';

const program = reqon`
  mission Example {
    source API { auth: bearer, base: "https://api.example.com" }
    store data: file("data")
    action Fetch { get "/data" }
    run Fetch
  }
`;

// Execute the program
const result = await program.execute();
```

## Configuration

### ExecutorConfig

```typescript
interface ExecutorConfig {
  // Skip actual HTTP requests
  dryRun?: boolean;

  // Enable verbose logging
  verbose?: boolean;

  // Authentication credentials
  auth?: Record<string, AuthConfig>;

  // Store configuration
  storeConfig?: Record<string, StoreConfig>;

  // State directory
  stateDir?: string;

  // Progress callbacks
  progressCallbacks?: ProgressCallbacks;
}
```

### AuthConfig

```typescript
type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api_key'; key: string; header?: string; query?: string; prefix?: string }
  | {
      type: 'oauth2';
      clientId: string;
      clientSecret: string;
      accessToken: string;
      refreshToken: string;
      tokenUrl: string;
      scopes?: string[];
      expiresAt?: string;
    };
```

### ProgressCallbacks

```typescript
interface ProgressCallbacks {
  onMissionStart?: (mission: string) => void;
  onMissionComplete?: (mission: string, result: ExecutionResult) => void;
  onActionStart?: (action: string) => void;
  onActionComplete?: (action: string, duration: number) => void;
  onProgress?: (progress: ProgressInfo) => void;
  onError?: (error: ExecutionError) => void;
}

interface ProgressInfo {
  action: string;
  step: string;
  current: number;
  total?: number;
}
```

## Results

### ExecutionResult

```typescript
interface ExecutionResult {
  // Whether execution completed successfully
  success: boolean;

  // Total duration in milliseconds
  duration: number;

  // Actions that were executed
  actionsRun: string[];

  // Errors encountered
  errors: ExecutionError[];

  // Access to stores
  stores: Map<string, StoreAdapter>;

  // Execution ID (for state tracking)
  executionId?: string;

  // Execution state (for resume)
  state?: ExecutionState;
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

## Store Adapter Interface

```typescript
interface StoreAdapter {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  update(key: string, partial: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<void>;
  list(filter?: FilterOptions): Promise<Record<string, unknown>[]>;
  clear(): Promise<void>;
}

interface FilterOptions {
  where?: WhereClause[];
  limit?: number;
  offset?: number;
}

interface WhereClause {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: unknown;
}
```

## Registration Functions

### registerFunction

Register a custom function.

```typescript
import { registerFunction } from 'reqon';

registerFunction('myFunc', (arg1: string, arg2: number) => {
  return `${arg1}: ${arg2}`;
});
```

### registerStoreAdapter

Register a custom store adapter.

```typescript
import { registerStoreAdapter } from 'reqon';

registerStoreAdapter('mystore', (name: string, config: any) => {
  return new MyStoreAdapter(name, config);
});
```

### registerAuthProvider

Register a custom auth provider.

```typescript
import { registerAuthProvider } from 'reqon';

registerAuthProvider('myauth', (config: any) => {
  return new MyAuthProvider(config);
});
```

### registerPaginationStrategy

Register a custom pagination strategy.

```typescript
import { registerPaginationStrategy } from 'reqon';

registerPaginationStrategy('linkheader', () => {
  return new LinkHeaderPaginationStrategy();
});
```

## State Management

### getExecutionState

Get execution state for a mission.

```typescript
import { getExecutionState } from 'reqon';

const state = await getExecutionState('CustomerSync');
console.log(state.status); // "completed"
console.log(state.lastRun); // "2024-01-20T09:00:00Z"
```

### getExecutionHistory

Get execution history.

```typescript
import { getExecutionHistory } from 'reqon';

const history = await getExecutionHistory('CustomerSync', {
  limit: 10,
  since: '2024-01-01'
});
```

### clearSyncCheckpoints

Clear sync checkpoints.

```typescript
import { clearSyncCheckpoints, clearSyncCheckpoint } from 'reqon';

// Clear all
await clearSyncCheckpoints();

// Clear specific
await clearSyncCheckpoint('API-/customers');
```

## AST Types

### ReqonProgram

```typescript
interface ReqonProgram {
  missions: MissionDefinition[];
}
```

### MissionDefinition

```typescript
interface MissionDefinition {
  type: 'MissionDefinition';
  name: string;
  schedule?: ScheduleConfig;
  sources: SourceDefinition[];
  stores: StoreDefinition[];
  schemas: SchemaDefinition[];
  actions: ActionDefinition[];
  pipeline: PipelineDefinition;
}
```

### ActionDefinition

```typescript
interface ActionDefinition {
  type: 'ActionDefinition';
  name: string;
  steps: ActionStep[];
}
```

### ActionStep

```typescript
type ActionStep =
  | FetchStep
  | CallStep
  | ForStep
  | MapStep
  | ValidateStep
  | StoreStep
  | MatchStep
  | LetStep
  | WebhookStep;
```

### LetStep

```typescript
interface LetStep {
  type: 'LetStep';
  name: string;
  value: Expression;
}
```

### WebhookStep

```typescript
interface WebhookStep {
  type: 'WebhookStep';
  timeout?: number;
  path?: string;
  expectedEvents?: number;
  eventFilter?: Expression;
  retryOnTimeout?: RetryConfig;
  storage?: {
    target: string;
    key?: Expression;
  };
}
```

## CLI Programmatic Usage

```typescript
import { CLI } from 'reqon/cli';

const cli = new CLI();

// Run mission
await cli.run(['./mission.vague', '--verbose']);

// Daemon mode
await cli.run(['./missions/', '--daemon']);

// With auth
await cli.run(['./mission.vague', '--auth', './credentials.json']);
```

## Observability

### createStructuredLogger

Create a structured logger with multiple outputs.

```typescript
import { createStructuredLogger, ConsoleOutput, JsonLinesOutput } from 'reqon';

const logger = createStructuredLogger({
  prefix: 'MyApp',
  level: 'info',
  console: true,
  jsonLines: true,
  context: { service: 'data-sync' }
});

logger.info('Starting sync', { count: 100 });
const span = logger.span('fetchData');
// ... do work
span.end();
```

### createEmitter

Create an event emitter for observability.

```typescript
import { createEmitter } from 'reqon';

const emitter = createEmitter();

emitter.on('fetch.complete', (event) => {
  console.log(`Fetched ${event.url} in ${event.duration}ms`);
});

emitter.on('mission.complete', (event) => {
  console.log(`Mission ${event.mission} completed`);
});
```

### OTLPExporter

Export traces to OpenTelemetry collectors.

```typescript
import { OTLPExporter, createOTelListener } from 'reqon';

const exporter = new OTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'reqon-pipeline'
});

const otelListener = createOTelListener(exporter);
```

### Event Types

```typescript
type EventType =
  | 'mission.start' | 'mission.complete' | 'mission.failed'
  | 'stage.start' | 'stage.complete'
  | 'step.start' | 'step.complete'
  | 'fetch.start' | 'fetch.complete' | 'fetch.retry' | 'fetch.error'
  | 'data.transform' | 'data.validate' | 'data.store'
  | 'loop.start' | 'loop.iteration' | 'loop.complete'
  | 'match.attempt' | 'match.result'
  | 'webhook.register' | 'webhook.event' | 'webhook.complete'
  | 'checkpoint.save' | 'checkpoint.resume' | 'sync.checkpoint'
  | 'ratelimit.hit' | 'circuitbreaker.state';
```

## MCP Server

### Starting the Server

```typescript
// As a separate process
import { spawn } from 'child_process';
spawn('npx', ['reqon-mcp-server', '--verbose']);
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `reqon.execute` | Execute mission from source |
| `reqon.execute_file` | Execute mission from file |
| `reqon.parse` | Parse and validate source |
| `reqon.query_store` | Query store data |
| `reqon.list_stores` | List registered stores |
| `reqon.register_store` | Register a store |

## Plugin System

### reqonPlugin

```typescript
import { reqonPlugin, registerReqonPlugin, unregisterReqonPlugin } from 'reqon';

// Check if registered
import { isReqonPluginRegistered } from 'reqon';
console.log(isReqonPluginRegistered()); // true (auto-registered on import)

// Unregister if needed
unregisterReqonPlugin();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REQON_STATE_DIR` | State directory (default: `.vague-data`) |
| `REQON_LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` |
| `REQON_LOG_FORMAT` | Log format: `text`, `json` |
| `REQON_DRY_RUN` | Enable dry-run mode |
| `REQON_OTEL_ENDPOINT` | OTLP exporter endpoint |
| `REQON_OTEL_SERVICE` | Service name for traces |

## Error Classes

```typescript
import {
  ParseError,
  RuntimeError,
  ValidationError,
  AuthenticationError,
  StoreError
} from 'reqon/errors';

try {
  await execute(source);
} catch (error) {
  if (error instanceof ParseError) {
    console.error(`Parse error at line ${error.line}: ${error.message}`);
  } else if (error instanceof AuthenticationError) {
    console.error(`Auth failed for ${error.source}: ${error.message}`);
  }
}
```

For more details, see the [source code](https://github.com/mcclowes/reqon) and [Vague documentation](https://github.com/mcclowes/vague) for expression syntax.
