---
sidebar_position: 4
---

# Extending Reqon

Reqon's extension model is dependency injection, not a plugin registry. You implement an interface and pass the instance to the executor through `ExecutorConfig`. There's no global `register*` API and no hook system.

## Custom store adapters

The most common extension point. Implement the `StoreAdapter` interface and pass your instances in the `stores` config, keyed by store name:

```typescript
import { execute, type StoreAdapter, type StoreFilter } from 'reqon';

class MyStoreAdapter implements StoreAdapter {
  async get(key: string) { /* ... */ return null; }
  async set(key: string, value: Record<string, unknown>) { /* ... */ }
  async update(key: string, value: Partial<Record<string, unknown>>) { /* ... */ }
  async delete(key: string) { /* ... */ }
  async list(filter?: StoreFilter) { return []; }
  async count(filter?: StoreFilter) { return 0; }
  async clear() { /* ... */ }
}

await execute(source, {
  stores: {
    customers: new MyStoreAdapter(),
  },
});
```

When a store name in the config matches a `store` declared in the mission, your adapter is used instead of the built-in one. Optional `bulkSet` and `bulkUpsert` methods are called when present for batched writes. See [custom adapters](../stores/custom-adapters) for the full interface.

## Custom durability stores

The execution store, sync store, trace store, and pause store are all injectable the same way:

```typescript
import { execute, MemoryExecutionStore, MemorySyncStore, MemoryTraceStore, MemoryPauseStore } from 'reqon';

await execute(source, {
  executionStore: new MemoryExecutionStore(),
  syncStore: new MemorySyncStore(),
  traceStore: new MemoryTraceStore(),
  pauseStore: new MemoryPauseStore(),
});
```

Each has a `File*` and a `Memory*` implementation out of the box, and a corresponding interface you can implement yourself.

## Observability outputs and handlers

Hook into execution by subscribing to the event emitter or by adding a custom log output. See [observability](../observability/overview) for the full event catalog.

```typescript
import { execute, ObservabilityEmitter, type LogOutput, type LogEntry } from 'reqon';

// Custom log output
class MyOutput implements LogOutput {
  write(entry: LogEntry) {
    // forward to your logging system
  }
}
```

## Vague plugin integration

Reqon extends [Vague](https://github.com/mcclowes/vague) (the underlying DSL layer) through its plugin system. The plugin teaches Vague's lexer about Reqon's keywords.

### Registering the plugin

Reqon registers its plugin automatically when you import the package. You can also register it explicitly:

```typescript
import { registerReqonPlugin } from 'reqon';

registerReqonPlugin();
```

### Inspecting the plugin

```typescript
import { reqonPlugin } from 'reqon';

console.log(reqonPlugin.name);  // 'reqon'
```

## Programmatic API

For full control, parse and execute directly with `MissionExecutor`:

```typescript
import { parse, MissionExecutor } from 'reqon';

const program = parse(source);

const executor = new MissionExecutor({
  dryRun: false,
  verbose: true,
  progress: {
    onStageComplete: (event) => console.log(`Stage done: ${event.stageName}`),
  },
});

const result = await executor.execute(program);
```

The convenience functions `execute`, `fromFile`, and `fromPath` wrap this for the common cases.

## Not currently supported

These extension points don't exist. Avoid building against them:

- **Custom expression functions** — there's no `registerFunction`. Expression functions come from Vague's evaluator.
- **Custom step handlers** — there's no `registerStepHandler`; step types are fixed.
- **Custom auth providers** — there's no `registerAuthProvider`. The built-in providers are bearer and OAuth2 (see [authentication](../authentication/overview)).
- **Custom pagination strategies** — there's no `registerPaginationStrategy`; the strategies are `offset`, `page`, and `cursor`.
- **A plugin/hook system** — there's no `Reqon` class, `reqon.use(...)`, or `reqon.hooks.*`. Use store/observability injection instead.
</content>
