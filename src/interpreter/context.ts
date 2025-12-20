import type { Expression, SchemaDefinition } from 'vague-lang';
import type { StoreAdapter } from '../stores/types.js';
import type { HttpClient } from './http.js';
import type { SourceDefinition, StoreDefinition } from '../ast/nodes.js';

export interface ExecutionContext {
  // Named stores
  stores: Map<string, StoreAdapter>;

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
}

export function createContext(): ExecutionContext {
  return {
    stores: new Map(),
    sources: new Map(),
    schemas: new Map(),
    variables: new Map(),
  };
}

export function childContext(parent: ExecutionContext): ExecutionContext {
  return {
    stores: parent.stores,
    sources: parent.sources,
    schemas: parent.schemas,
    variables: new Map(),
    parent,
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
