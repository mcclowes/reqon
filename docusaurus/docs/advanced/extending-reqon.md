---
sidebar_position: 4
---

# Extending Reqon

Extend Reqon with custom functions, store adapters, and integrations.

## Custom Functions

Register custom functions for use in expressions:

```typescript
import { registerFunction, execute } from 'reqon';

// Register a custom function
registerFunction('formatCurrency', (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount);
});

// Use in mission
await execute(`
  mission Example {
    action Format {
      map order -> Formatted {
        total: formatCurrency(.amount, "USD")
      }
    }
  }
`);
```

### Function Types

```typescript
// Simple function
registerFunction('double', (x: number) => x * 2);

// Async function
registerFunction('fetchRate', async (currency: string) => {
  const response = await fetch(`/rates/${currency}`);
  return response.json();
});

// Variadic function
registerFunction('sum', (...args: number[]) => {
  return args.reduce((a, b) => a + b, 0);
});
```

### Using Custom Functions

```vague
map order -> Output {
  doubled: double(.quantity),
  rate: fetchRate(.currency),
  total: sum(.item1, .item2, .item3)
}
```

## Custom Store Adapters

See [Custom Adapters](../stores/custom-adapters) for full documentation.

```typescript
import { registerStoreAdapter, StoreAdapter } from 'reqon';

class MyStoreAdapter implements StoreAdapter {
  async get(key: string) { /* ... */ }
  async set(key: string, value: any) { /* ... */ }
  async update(key: string, partial: any) { /* ... */ }
  async delete(key: string) { /* ... */ }
  async list(filter?: any) { /* ... */ }
  async clear() { /* ... */ }
}

registerStoreAdapter('mystore', (name, config) => {
  return new MyStoreAdapter(config);
});
```

## Custom Auth Providers

```typescript
import { registerAuthProvider, AuthProvider } from 'reqon';

class MyAuthProvider implements AuthProvider {
  async getToken(): Promise<string> {
    // Custom token acquisition logic
    return 'my-token';
  }

  async refreshToken(): Promise<string> {
    // Custom refresh logic
    return 'new-token';
  }

  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'Authorization': `Bearer ${token}`,
      'X-Custom-Auth': 'value'
    };
  }
}

registerAuthProvider('myauth', (config) => {
  return new MyAuthProvider(config);
});
```

Usage:

```vague
source API {
  auth: myauth,
  base: "https://api.example.com"
}
```

## Custom Step Handlers

Add custom step types:

```typescript
import { registerStepHandler, ExecutionContext } from 'reqon';

registerStepHandler('notify', async (step, ctx: ExecutionContext) => {
  const { channel, message } = step.options;

  await sendNotification(channel, message);

  return { success: true };
});
```

Usage:

```vague
action WithNotification {
  get "/data"
  store response -> data { key: .id }

  notify {
    channel: "slack",
    message: concat("Synced ", length(response), " items")
  }
}
```

## Vague Plugin Integration

Reqon extends Vague (the underlying DSL layer) via its plugin system. This allows Reqon keywords to be recognized by Vague's lexer.

### Registering Reqon

Reqon auto-registers with Vague on import:

```typescript
import { parse } from 'reqon';  // Auto-registers reqonPlugin

// Or explicitly register
import { registerReqonPlugin } from 'reqon';
registerReqonPlugin();
```

### Plugin Structure

The Reqon plugin adds keywords to Vague:

```typescript
import { reqonPlugin, registerReqonPlugin, unregisterReqonPlugin } from 'reqon';

console.log(reqonPlugin.name);     // 'reqon'
console.log(reqonPlugin.keywords); // Array of Reqon keywords
```

## Plugins

### Creating a Plugin

```typescript
import { Plugin, Reqon } from 'reqon';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  install(reqon: Reqon) {
    // Register functions
    reqon.registerFunction('myFunc', () => {});

    // Register store adapters
    reqon.registerStoreAdapter('mystore', () => {});

    // Add hooks
    reqon.hooks.beforeExecute.tap('my-plugin', (mission) => {
      console.log(`Starting: ${mission.name}`);
    });

    reqon.hooks.afterExecute.tap('my-plugin', (result) => {
      console.log(`Completed: ${result.duration}ms`);
    });
  }
};

export default myPlugin;
```

### Using a Plugin

```typescript
import { Reqon } from 'reqon';
import myPlugin from './my-plugin';

const reqon = new Reqon();
reqon.use(myPlugin);

await reqon.execute(source);
```

## Execution Hooks

### Available Hooks

```typescript
reqon.hooks.beforeParse.tap('plugin', (source) => {
  // Before parsing mission source
});

reqon.hooks.afterParse.tap('plugin', (ast) => {
  // After parsing, before execution
});

reqon.hooks.beforeExecute.tap('plugin', (mission) => {
  // Before mission starts
});

reqon.hooks.afterExecute.tap('plugin', (result) => {
  // After mission completes
});

reqon.hooks.beforeAction.tap('plugin', (action) => {
  // Before each action
});

reqon.hooks.afterAction.tap('plugin', (action, result) => {
  // After each action
});

reqon.hooks.beforeStep.tap('plugin', (step) => {
  // Before each step
});

reqon.hooks.afterStep.tap('plugin', (step, result) => {
  // After each step
});

reqon.hooks.onError.tap('plugin', (error, context) => {
  // On any error
});
```

### Hook Examples

```typescript
// Logging hook
reqon.hooks.beforeAction.tap('logger', (action) => {
  console.log(`[${new Date().toISOString()}] Starting: ${action.name}`);
});

// Metrics hook
reqon.hooks.afterAction.tap('metrics', (action, result) => {
  metrics.record('action_duration', {
    action: action.name,
    duration: result.duration,
    success: result.success
  });
});

// Error notification hook
reqon.hooks.onError.tap('notify', (error, context) => {
  sendSlackMessage(`Error in ${context.mission}: ${error.message}`);
});
```

## Custom Pagination Strategies

```typescript
import { registerPaginationStrategy, PaginationStrategy } from 'reqon';

class LinkHeaderPagination implements PaginationStrategy {
  private nextUrl: string | null = null;

  getInitialParams(): Record<string, any> {
    return {};
  }

  hasMore(): boolean {
    return this.nextUrl !== null;
  }

  getNextParams(): Record<string, any> {
    // Parse from nextUrl
    return { url: this.nextUrl };
  }

  updateFromResponse(response: any, headers: Headers): void {
    const linkHeader = headers.get('Link');
    this.nextUrl = parseLinkHeader(linkHeader).next;
  }
}

registerPaginationStrategy('link', () => new LinkHeaderPagination());
```

Usage:

```vague
get "/items" {
  paginate: link(),
  until: !hasMore
}
```

## Programmatic API

### Full Control

```typescript
import { Reqon, parse, createContext } from 'reqon';

// Parse source
const ast = parse(source);

// Create execution context
const ctx = createContext({
  stores: new Map(),
  sources: new Map(),
  variables: new Map()
});

// Execute with custom options
const reqon = new Reqon();
const result = await reqon.executeMission(ast.missions[0], ctx, {
  dryRun: false,
  progressCallbacks: {
    onProgress: (p) => updateUI(p)
  }
});
```

### AST Manipulation

```typescript
import { parse, transform } from 'reqon';

const ast = parse(source);

// Transform AST
const transformed = transform(ast, {
  visitFetchStep(node) {
    // Add retry to all fetches
    return {
      ...node,
      options: {
        ...node.options,
        retry: { maxAttempts: 3 }
      }
    };
  }
});
```

## Best Practices

### Namespace Functions

```typescript
// Good: namespaced
registerFunction('myPlugin_formatDate', () => {});

// Avoid: may conflict
registerFunction('format', () => {});
```

### Document Extensions

```typescript
/**
 * Formats a phone number to E.164 format
 * @param phone - Raw phone number
 * @param country - ISO country code
 * @returns Formatted phone number
 * @example formatPhone("555-1234", "US") => "+15551234"
 */
registerFunction('formatPhone', (phone, country) => {});
```

### Test Thoroughly

```typescript
describe('formatPhone', () => {
  it('formats US numbers', () => {
    expect(formatPhone('555-1234', 'US')).toBe('+15551234');
  });

  it('handles international numbers', () => {
    expect(formatPhone('7911 123456', 'GB')).toBe('+447911123456');
  });
});
```
