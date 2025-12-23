# Principal Engineer Code Review: Reqon DSL Framework

**Reviewer**: Principal Software Engineer (New Hire Onboarding)
**Date**: December 2024
**Scope**: Holistic codebase review focusing on architecture, edge cases, and engineering principles

---

## Executive Summary

Reqon is a declarative DSL for data pipelines built on top of Vague. While the codebase shows solid fundamentals—strict TypeScript, good test coverage (~203 test files), and thoughtful module organization—there are significant concerns around error handling consistency, type safety gaps, and architectural complexity that will cause issues at scale.

**Overall Grade: B-** — Competent implementation with notable blind spots.

### Critical Issues Addressed (December 2024)

The following critical issues identified in this review have been fixed:

1. **FileStore Async Constructor** ✅ - Implemented factory pattern with `FileStore.create()` and lazy initialization with proper error caching
2. **Global Pagination Cache** ✅ - Moved to instance-level caches with TTL and automatic cleanup
3. **MissionExecutor Refactoring** ✅ - Extracted `SourceManager` and `StoreManager` classes to improve separation of concerns
4. **JSON Parse Failure in HTTP Client** ✅ - Added `parseResponseBody()` with helpful error messages including content-type context
5. **Type Guards in Evaluator** ✅ - Added `toNumber()` and `compareNumbers()` helpers with proper type coercion and division-by-zero checks
6. **Non-null Assertion on Undefined Source** ✅ - Fixed fetch-handler to properly check if sources exist before using

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [Architectural Concerns](#2-architectural-concerns)
3. [Edge Cases Not Handled](#3-edge-cases-not-handled)
4. [Type Safety Problems](#4-type-safety-problems)
5. [Error Handling Issues](#5-error-handling-issues)
6. [Concurrency & Race Conditions](#6-concurrency--race-conditions)
7. [Security Considerations](#7-security-considerations)
8. [Performance Pitfalls](#8-performance-pitfalls)
9. [Testing Gaps](#9-testing-gaps)
10. [Code Smells & Anti-Patterns](#10-code-smells--anti-patterns)
11. [What Was Done Well](#11-what-was-done-well)
12. [Recommendations for Junior Engineers](#12-recommendations-for-junior-engineers)

---

## 1. Critical Issues

### 1.1 God Class: MissionExecutor (1,144 lines)

**Location**: `src/interpreter/executor.ts`

The `MissionExecutor` class violates Single Responsibility Principle. It handles:
- Execution orchestration
- Source initialization
- Store initialization
- State persistence
- Event emission
- Rate limiting coordination
- Circuit breaker coordination
- Logging

**Why this matters**: When something breaks in execution, you're debugging 1,144 lines. When you need to modify source initialization, you risk breaking store initialization. This coupling will slow down every developer who touches this file.

```typescript
// executor.ts:187-203 - Too many instance variables is a code smell
export class MissionExecutor {
  private config: ExecutorConfig;
  private ctx: ExecutionContext;
  private errors: ExecutionError[] = [];
  private actionsRun: string[] = [];
  private oasSources: Map<string, OASSource> = new Map();
  private sourceConfigs: Map<string, SourceDefinition> = new Map();
  private transforms: Map<string, TransformDefinition> = new Map();
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private executionStore?: ExecutionStore;
  private executionState?: ExecutionState;
  private syncStore?: SyncStore;
  private missionName?: string;
  private eventEmitter?: EventEmitter;
  private logger?: StructuredLogger;
  private stepIndex = 0;  // <-- Mutable state across execution
```

**Fix**: Extract into `SourceManager`, `StoreManager`, `ExecutionStateManager` classes.

### 1.2 Async Constructor Anti-Pattern

**Location**: `src/stores/file.ts:39-47`

```typescript
constructor(name: string, options: FileStoreOptions = {}) {
  this.options = { ...DEFAULT_OPTIONS, ...options };
  this.filePath = join(this.options.baseDir, `${name}.json`);
  this.initialized = this.init();  // <-- Promise stored in constructor
}
```

**Why this is dangerous**: The store appears ready immediately after construction, but it isn't. Every method must `await this.initialized`, and if any code path forgets this, you get subtle race conditions.

**Edge case not handled**: What happens if `init()` fails? The `initialized` promise rejects, but subsequent calls to `get()` or `set()` will wait forever because they `await this.initialized` which throws, not retries.

```typescript
// This will throw on every call after init fails
async get(key: string): Promise<Record<string, unknown> | null> {
  await this.initialized;  // Throws if init() failed
  return this.data.get(key) ?? null;
}
```

**Fix**: Use factory pattern:
```typescript
class FileStore {
  static async create(name: string, options?: FileStoreOptions): Promise<FileStore> {
    const store = new FileStore(name, options);
    await store.init();
    return store;
  }
}
```

### 1.3 Global Mutable State in Pagination Cache

**Location**: `src/interpreter/pagination.ts:34`

```typescript
/** Cache for discovered array field keys to avoid repeated lookups */
const arrayFieldCache: Map<string, string | null> = new Map();
```

**Problems**:
1. Module-level mutable state is shared across all executions
2. Cache never expires—memory leak in long-running processes
3. If API response structure changes, stale cache causes incorrect results
4. No thread safety (though less of an issue in Node.js single-threaded model)

**Edge case**: If you fetch from `API1` which returns `{ items: [...] }`, then later the API changes to return `{ data: [...] }`, cached key `"items"` causes empty results.

---

## 2. Architectural Concerns

### 2.1 Parser Validates Too Late

**Location**: `src/parser/parser.ts:121`

```typescript
// After parsing entire mission:
this.validateActionReferences(actions, definedStores, definedSources, definedActions, definedTransforms);
```

References are validated *after* parsing completes. For a 500-line DSL file, you parse everything before discovering a typo in the first store reference. This wastes CPU cycles and delays error feedback.

**Better approach**: Validate references during parsing or use a two-pass approach where the first pass collects definitions.

### 2.2 Context Swapping in Executor

**Location**: `src/interpreter/executor.ts:898-1001`

```typescript
private async executeStep(step: ActionStep, actionName: string, ctx?: ExecutionContext): Promise<void> {
  const execCtx = ctx ?? this.ctx;
  const originalCtx = this.ctx;

  // Temporarily use the provided context
  if (ctx) {
    this.ctx = ctx;  // <-- Mutating instance state
  }

  // ... execute step ...

  } finally {
    // Restore original context
    if (ctx) {
      this.ctx = originalCtx;  // <-- Restoring in finally
    }
  }
}
```

This is fragile. Any exception in the step handlers could leave `this.ctx` in an inconsistent state between the exception and the finally block. Also makes the code hard to reason about—"which context am I using right now?"

**Better approach**: Pass context explicitly to all methods rather than swapping instance state.

### 2.3 Inconsistent Dependency Injection

Some handlers receive dependencies via constructor:
```typescript
// FetchHandler receives everything in deps
constructor(private deps: FetchHandlerDeps) {}
```

While the executor passes callbacks inline:
```typescript
// executor.ts:1013-1014
log: (msg) => this.log(msg),
emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
```

This inconsistency makes testing harder and creates tight coupling.

---

## 3. Edge Cases Not Handled

### 3.1 Empty Stores in For Loops

**Location**: `src/interpreter/step-handlers/for-handler.ts:70-93`

```typescript
private async getCollection(step: ForStep): Promise<unknown[]> {
  if (step.collection.type === 'Identifier') {
    const store = this.deps.ctx.stores.get(step.collection.name);
    if (store) {
      collection = await store.list();  // What if this returns undefined?
    } else {
      collection = (getVariable(this.deps.ctx, step.collection.name) as unknown[]) ?? [];
    }
  } else {
    collection = evaluate(step.collection, this.deps.ctx) as unknown[];
  }
```

**Missing edge cases**:
1. `store.list()` could throw (network error, permission denied)
2. Store might return `null` instead of empty array
3. What if collection is a sparse array?

### 3.2 OAuth2 Token Refresh Race Condition

**Location**: `src/interpreter/http.ts:138-144`

```typescript
// Handle 401 - try token refresh
if (response.status === 401 && this.config.auth?.refreshToken && attempt < maxAttempts) {
  await this.config.auth.refreshToken();
  // Rebuild headers with new token
  const newHeaders = await this.buildHeaders(req.headers);
  fetchOptions.headers = newHeaders;
  continue;
}
```

**Problem**: In a parallel execution scenario (which Reqon supports!), multiple requests could hit 401 simultaneously. Each would trigger `refreshToken()`, potentially causing multiple refresh attempts to race. The first might succeed while others get "refresh token already used" errors.

**Not handled**: The refresh token itself could be expired or revoked.

### 3.3 JSON Parse Failure in HTTP Client ✅ FIXED

**Location**: `src/interpreter/http.ts:186-203`

**Original problem**: Calling `response.json()` directly would throw unhelpful errors like "Unexpected token < in JSON at position 0" when APIs return HTML error pages or plain text.

**Fix applied**: Added `parseResponseBody()` method that attempts JSON parsing and provides contextual error messages including the content-type header when parsing fails.

### 3.4 PostgREST Count with Large Tables

**Location**: `src/stores/postgrest.ts:200-240`

```typescript
async count(filter?: StoreFilter): Promise<number> {
  // ...
  const range = response.headers.get('Content-Range');
  if (range) {
    const match = range.match(/\/(\d+|\*)/);
    if (match && match[1] !== '*') {
      return parseInt(match[1], 10);
    }
  }

  // Fallback: count the results
  const data = await response.json();
  return Array.isArray(data) ? data.length : 0;
}
```

**Edge case**: If Content-Range returns `*` (unknown count for very large tables), the fallback loads ALL records into memory just to count them. On a million-row table, this causes OOM.

### 3.5 Pagination Infinite Loop Prevention Isn't Enough

**Location**: `src/interpreter/fetch-handler.ts:13`

```typescript
const MAX_PAGINATION_PAGES = 100;
```

**Problems**:
1. 100 pages * N items/page could still be massive (100 * 10,000 = 1M records in memory)
2. No way to configure this per-mission
3. No memory pressure detection
4. The warning message doesn't suggest a fix

### 3.6 File Store Debounce Timer Leak

**Location**: `src/stores/file.ts:80-94`

```typescript
private scheduleDebouncedWrite(): void {
  if (this.debounceTimer) {
    clearTimeout(this.debounceTimer);
  }
  this.debounceTimer = setTimeout(() => {
    // ...
  }, this.options.debounceMs);
}
```

**Edge case**: If the process crashes between scheduling and execution, data is lost. The `flush()` method exists but must be called explicitly—no automatic flush on process exit.

**Also**: What if `writeToDisk()` throws inside the setTimeout? The error is swallowed.

### 3.7 Rate Limiter State Grows Unbounded

**Location**: `src/auth/rate-limiter.ts:77-104`

While there's cleanup logic, it only runs periodically. A long-running process hitting many different endpoints (like cursor-paginated APIs with unique URLs) will accumulate entries faster than cleanup removes them.

---

## 4. Type Safety Problems

### 4.1 Excessive `unknown` Casting

**Location**: Throughout `src/interpreter/evaluator.ts`

```typescript
// evaluator.ts:109-110 - trusting that left/right are numbers
case '+':
  return (left as number) + (right as number);
```

**What happens when**:
- `left` is a string? You get string concatenation, not addition
- `left` is `null`? You get `NaN`
- `left` is an object? You get `"[object Object]undefined"`

The evaluator has no runtime type checking before arithmetic operations.

### 4.2 Type Assertions Without Guards

**Location**: `src/interpreter/step-handlers/for-handler.ts:73`

```typescript
const record = item as Record<string, unknown>;
```

No check that `item` is actually an object. If `item` is a primitive or `null`, subsequent property access will fail cryptically.

### 4.3 Missing Null Checks in Evaluator

**Location**: `src/interpreter/evaluator.ts:62-64`

```typescript
if (isRecord(ctx.response) && expr.name in ctx.response) {
  return ctx.response[expr.name];
}
```

The `isRecord()` call should handle null/undefined, but I don't see that check in the type guard implementation shown.

### 4.4 Source Name Can Be Undefined

**Location**: `src/interpreter/fetch-handler.ts:218`

```typescript
const sourceName = step.source ?? this.deps.ctx.sources.keys().next().value!;
```

That `!` non-null assertion is dangerous. What if there are no sources defined? The `keys().next().value` would be `undefined`, and the `!` just hides this from TypeScript.

---

## 5. Error Handling Issues

### 5.1 Rich Error Classes Defined But Not Used

**Location**: `src/errors/index.ts` defines `StepError`, `FetchError`, `StoreError`, `EvaluatorError`

But throughout the codebase, we see:

```typescript
// executor.ts:577
throw new Error(`Action not found: ${actionName}`);

// executor.ts:813
throw new Error(`Failed to load OAS spec for ${source.name}: ${(error as Error).message}`);

// fetch-handler.ts:48
throw new Error(`Source not found: ${resolved.sourceName}`);
```

**Why this matters**: The rich error types exist to provide actionable context (source location, step type, etc.). Using generic `Error` throws away this debugging information.

### 5.2 Error Wrapping Loses Stack Traces

**Location**: `src/stores/postgrest.ts:83-84`

```typescript
const error = await this.parseError(response);
throw new PostgRESTError(`Failed to set record: ${error}`, response.status);
```

The original error (if any) isn't preserved as `cause`. When debugging, you can't see what actually went wrong at the HTTP level.

### 5.3 Catch Blocks Don't Discriminate Error Types

**Location**: `src/interpreter/executor.ts:328-343`

```typescript
} catch (error) {
  this.errors.push({
    action: 'mission',
    step: 'execute',
    message: (error as Error).message,
    details: error,
  });
```

All errors are treated the same. Network timeouts, validation failures, and programming bugs all get the same handling.

---

## 6. Concurrency & Race Conditions

### 6.1 Parallel Stage Execution Shares Context

**Location**: `src/interpreter/executor.ts:660-777`

```typescript
// Execute all actions in parallel
const results = await Promise.allSettled(
  actionDefs.map(action => this.executeAction(action))
);
```

All parallel actions share the same `this.ctx`. If Action A writes to `ctx.response` while Action B reads it, you get non-deterministic behavior.

### 6.2 Store Handlers Aren't Thread-Safe

**Location**: `src/stores/memory.ts` and `src/stores/file.ts`

The stores use simple `Map`s with no locking. In parallel stages, concurrent `set()` calls could interleave:

```
T1: get("key") -> null
T2: get("key") -> null
T1: set("key", {count: 1})
T2: set("key", {count: 1})  // Overwrites T1's write
// Expected count: 2, Actual: 1
```

### 6.3 Rate Limiter Shared Across Parallel Requests

**Location**: `src/interpreter/http.ts:85-87`

```typescript
if (this.config.rateLimiter && this.config.sourceName) {
  await this.config.rateLimiter.waitForCapacity(this.config.sourceName, req.path);
}
```

In parallel execution, multiple requests wait for capacity, but all might proceed when capacity is available, exceeding the rate limit again.

---

## 7. Security Considerations

### 7.1 Path Interpolation Could Allow Path Traversal

**Location**: `src/interpreter/evaluator.ts:269-285`

```typescript
export function interpolatePath(path: string, ctx: ExecutionContext, current?: unknown): string {
  return path.replace(/\{([^}]+)\}/g, (_, expr) => {
    // ...
    return String(value ?? '');
  });
}
```

If user-controlled data ends up in path interpolation:
```
path = "/users/{id}/files"
id = "../../../etc/passwd"
result = "/users/../../../etc/passwd/files"
```

No sanitization of path traversal characters.

### 7.2 Environment Variable Exposure

**Location**: `src/interpreter/evaluator.ts:206`

```typescript
case 'env':
  return process.env[args[0] as string] ?? '';
```

Any environment variable is accessible to the DSL. If secrets are in env vars (which is common), they're exposed to DSL authors.

### 7.3 No Input Validation on Store Keys

Store keys are user-controlled and go directly into:
- File paths (`file.ts`)
- Database queries (`postgrest.ts`)
- URL paths (`postgrest.ts:54`)

```typescript
// postgrest.ts:54 - key goes directly into URL
const url = `${this.baseUrl}?${this.primaryKey}=eq.${encodeURIComponent(key)}&limit=1`;
```

At least `encodeURIComponent` is used here, but the `list()` method doesn't encode filter values:

```typescript
// postgrest.ts:131
params.append(field, `eq.${JSON.stringify(value)}`);  // JSON.stringify isn't URL encoding
```

---

## 8. Performance Pitfalls

### 8.1 N+1 Store Operations in For Loops

**Location**: `src/interpreter/step-handlers/for-handler.ts`

```typescript
for (let i = 0; i < filtered.length; i++) {
  const item = filtered[i];
  await this.executeForItem(step, item);
}
```

If each loop iteration does a store operation, you get N database round-trips. Consider:
```yaml
for invoice in invoices {
  store invoice -> db { key: .id }
}
```

On 10,000 invoices = 10,000 store calls. Could be 1 batch operation.

### 8.2 Full Store Load for Count

**Location**: `src/stores/memory.ts:54-59` and `src/stores/file.ts:169-175`

```typescript
async count(filter?: StoreFilter): Promise<number> {
  const filtered = applyStoreFilter(Array.from(this.data.values()), {
    where: filter?.where,
  });
  return filtered.length;
}
```

To count records, we:
1. Convert all Map values to array
2. Apply filter (iterates all)
3. Return length

For large datasets, this is O(n) when it should be O(1) for simple counts.

### 8.3 Repeated Schema Parsing in Validation

OAS schemas are parsed fresh each time `validateOASResponse` is called. No caching of compiled validators.

### 8.4 Console.log in Production Path

**Location**: `src/interpreter/executor.ts:1117`

```typescript
} else if (this.config.verbose) {
  console.log(`[Reqon] ${message}`);
}
```

`console.log` is synchronous and blocks the event loop. In high-throughput scenarios with verbose logging, this kills performance.

---

## 9. Testing Gaps

### 9.1 Happy Path Bias

Most tests verify successful scenarios. Looking at `executor.test.ts`, the first 200+ lines test success cases.

**Missing negative tests**:
- Network failures mid-pagination
- Auth refresh failures
- Store initialization failures
- Circular action references
- Malformed OAS specs
- Rate limit timeout handling

### 9.2 No Fuzz Testing

The parser handles arbitrary input. There's no property-based testing to catch:
- Stack overflow on deeply nested expressions
- Memory exhaustion on pathological inputs
- Unexpected characters in identifiers

### 9.3 No Integration Tests for Parallel Execution

The parallel stage feature is tested in isolation but not under realistic conditions where race conditions would manifest.

### 9.4 Mocking Hides Real Issues

```typescript
// Many tests use inline mocks
const mockStore = { get: vi.fn(), set: vi.fn() };
```

These mocks don't verify the contract properly. A store's `set()` should affect subsequent `get()` calls, but mocks don't enforce this.

---

## 10. Code Smells & Anti-Patterns

### 10.1 Magic Numbers

```typescript
// fetch-handler.ts:13
const MAX_PAGINATION_PAGES = 100;

// Scattered throughout rate-limiter.ts
const sleepMs = Math.min(Math.max(remainingMs, 1000), 5000);  // Why 5000?
```

### 10.2 Boolean Blindness

```typescript
// executor.ts:146
dryRun?: boolean;
```

What does `dryRun` mean exactly? Does it skip network calls? Does it skip stores? Does it log differently? A discriminated union or config object would be clearer.

### 10.3 Primitive Obsession

Source names, action names, store names are all `string`. You can accidentally pass a store name where a source name is expected.

### 10.4 Mutable Instance State

```typescript
// executor.ts:203
private stepIndex = 0;
```

This counter increments during execution and is never reset. If you reuse an executor, step indices will be wrong.

### 10.5 Dead Code Path

**Location**: `src/interpreter/executor.ts:1132`

```typescript
private getStepType(stepType: string): StepType {
  const mapping: Record<string, StepType> = {
    // ...
  };
  return mapping[stepType] ?? 'fetch';  // <-- Why default to 'fetch'?
}
```

If an unknown step type is encountered, it silently becomes 'fetch' for observability purposes. This hides bugs.

---

## 11. What Was Done Well

### 11.1 No `@ts-ignore` or `eslint-disable`

Searched the entire `src/` directory—zero suppression comments. This shows discipline.

### 11.2 Strategy Pattern for Pagination

**Location**: `src/interpreter/pagination.ts`

```typescript
export interface PaginationStrategy {
  buildQuery(ctx: PaginationContext): Record<string, string>;
  extractResults(response: unknown, ctx: PaginationContext): PageResult;
}
```

Clean abstraction that makes adding new pagination types straightforward.

### 11.3 Circuit Breaker Implementation

**Location**: `src/auth/circuit-breaker.ts`

The state machine is correctly implemented with proper transitions between closed/open/half-open states. Failure windows are pruned correctly.

### 11.4 Error Formatting

**Location**: `src/errors/index.ts:32-63`

```typescript
format(): string {
  const lines: string[] = [];
  // Shows source context with line numbers and underline
}
```

Beautiful error messages with source context, similar to Rust compiler errors.

### 11.5 Handler Pattern for Steps

Step handlers are properly factored out with clean interfaces:
```typescript
export interface StepHandler<T extends ActionStep> {
  execute(step: T): Promise<void>;
}
```

### 11.6 Comprehensive Type Guards

**Location**: `src/utils/type-guards.ts`

```typescript
export function isRecord(value: unknown): value is Record<string, unknown>
```

Using type guards instead of casts in many places.

---

## 12. Recommendations for Junior Engineers

### 12.1 Before Writing Code

1. **Read the error classes first** (`src/errors/index.ts`). Use them. The rich context helps everyone debug.

2. **Understand the context flow**. `ExecutionContext` is passed everywhere. Know what's in it before accessing it.

3. **Check existing patterns**. Before adding a new store adapter, read all existing ones. Notice the shared patterns.

### 12.2 When Adding Features

1. **Add negative tests first**. What should happen when this fails? Write that test before the implementation.

2. **Consider parallel execution**. Your feature might run concurrently with other actions. Does your code handle that?

3. **Validate inputs at boundaries**. User-provided data (from DSL) should be validated before use. Don't trust it.

### 12.3 When Fixing Bugs

1. **Add a failing test first**. Reproduce the bug in a test, then fix it. The test prevents regression.

2. **Check related code**. If there's a bug in `MemoryStore.set()`, there's probably one in `MemoryStore.update()` too.

3. **Preserve error context**. When catching and re-throwing, use `cause` to preserve the original:
```typescript
throw new StepError(`Failed to execute`, 'store', { cause: originalError });
```

### 12.4 General Principles

1. **Explicit is better than implicit**. Pass dependencies explicitly rather than accessing global state.

2. **Make illegal states unrepresentable**. Use TypeScript's type system to prevent bugs at compile time.

3. **Fail fast, fail loud**. Don't silently default to 'fetch' for unknown step types. Throw an error immediately.

4. **Document edge cases**. When you find one, add a comment AND a test.

---

## Appendix: Priority Fixes

### P0 (Do Immediately)
1. Fix async constructor pattern in `FileStore`
2. Add null check before `response.json()` in HTTP client
3. Bound memory usage in pagination

### P1 (This Quarter)
1. Extract MissionExecutor into smaller classes
2. Add type guards before arithmetic operations in evaluator
3. Make parallel execution context-safe

### P2 (Next Quarter)
1. Refactor parser to validate during parsing
2. Add property-based testing for parser
3. Implement proper connection pooling for PostgREST
