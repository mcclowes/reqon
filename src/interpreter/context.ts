/**
 * ---
 * purpose: Execution context - scoped state for variables, stores, sources
 * exports:
 *   - ExecutionContext - interface for execution state
 *   - createContext, childContext - context factory functions
 *   - getVariable, setVariable - scoped variable access
 * related:
 *   - ./executor.ts - creates and uses contexts
 *   - ./evaluator.ts - reads from context during expression evaluation
 *   - ../stores/types.ts - StoreAdapter interface
 * ---
 */

import type { SchemaDefinition } from 'vague-lang';
import type { StoreAdapter } from '../stores/types.js';
import type { HttpClient } from './http.js';

/**
 * Mutable per-action execution state. Parallel actions (`run [A, B]`) must not
 * share this — each gets its own scope so their step counters and deferred sync
 * checkpoints can't corrupt each other. Nested scopes (for/match) inherit the
 * same reference so the whole action shares one counter/checkpoint list.
 */
export interface ActionScope {
  /** Monotonic step index within the action (for trace/debug positions). */
  stepIndex: number;
  /** Sync checkpoints deferred until the action's data is durably stored. */
  pendingCheckpoints: Array<() => Promise<void>>;
}

export interface ExecutionContext {
  // Named stores
  stores: Map<string, StoreAdapter>;

  // Store type info (for observability events)
  storeTypes: Map<string, string>;

  // Named HTTP clients (sources)
  sources: Map<string, HttpClient>;

  // Schema definitions (for match step schema matching)
  schemas: Map<string, SchemaDefinition>;

  // Variable bindings for current scope
  variables: Map<string, unknown>;

  // Current response from last fetch
  response?: unknown;

  // Parent context (for nested scopes)
  parent?: ExecutionContext;

  // Per-action mutable state (step counter, deferred checkpoints).
  actionScope?: ActionScope;
}

export function createContext(): ExecutionContext {
  return {
    stores: new Map(),
    storeTypes: new Map(),
    sources: new Map(),
    schemas: new Map(),
    variables: new Map(),
  };
}

export function childContext(parent: ExecutionContext): ExecutionContext {
  return {
    stores: parent.stores,
    storeTypes: parent.storeTypes,
    sources: parent.sources,
    schemas: parent.schemas,
    variables: new Map(),
    parent,
    // Nested scopes (for/match) share the action's scope so the step counter
    // and checkpoint list stay coherent across the whole action.
    actionScope: parent.actionScope,
  };
}

export function getVariable(ctx: ExecutionContext, name: string): unknown {
  if (ctx.variables.has(name)) {
    return ctx.variables.get(name);
  }
  if (ctx.parent) {
    return getVariable(ctx.parent, name);
  }
  return undefined;
}

export function setVariable(ctx: ExecutionContext, name: string, value: unknown): void {
  ctx.variables.set(name, value);
}
