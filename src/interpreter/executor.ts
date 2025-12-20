import type { Expression } from 'vague-lang';
import type {
  ReqonProgram,
  MissionDefinition,
  ActionDefinition,
  ActionStep,
  FetchStep,
  ForStep,
  MapStep,
  ValidateStep,
  StoreStep,
  PipelineDefinition,
  SourceDefinition,
  StoreDefinition,
  FieldMapping,
} from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import { createContext, childContext, setVariable, getVariable } from './context.js';
import { evaluate, interpolatePath } from './evaluator.js';
import { HttpClient, BearerAuthProvider, OAuth2AuthProvider } from './http.js';
import { MemoryStore } from '../stores/memory.js';
import type { StoreAdapter } from '../stores/types.js';

export interface ExecutionResult {
  success: boolean;
  duration: number;
  actionsRun: string[];
  errors: ExecutionError[];
  stores: Map<string, StoreAdapter>;
}

export interface ExecutionError {
  action: string;
  step: string;
  message: string;
  details?: unknown;
}

export interface ExecutorConfig {
  // Auth tokens for sources
  auth?: Record<string, AuthConfig>;
  // Custom store adapters
  stores?: Record<string, StoreAdapter>;
  // Dry run mode
  dryRun?: boolean;
  // Verbose logging
  verbose?: boolean;
}

interface AuthConfig {
  type: 'bearer' | 'oauth2';
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
}

export class MissionExecutor {
  private config: ExecutorConfig;
  private ctx: ExecutionContext;
  private errors: ExecutionError[] = [];
  private actionsRun: string[] = [];

  constructor(config: ExecutorConfig = {}) {
    this.config = config;
    this.ctx = createContext();
  }

  async execute(program: ReqonProgram): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Find mission definition
    const mission = program.statements.find(
      (s): s is MissionDefinition => s.type === 'MissionDefinition'
    );

    if (!mission) {
      return {
        success: false,
        duration: Date.now() - startTime,
        actionsRun: [],
        errors: [{ action: '', step: '', message: 'No mission found in program' }],
        stores: this.ctx.stores,
      };
    }

    try {
      await this.executeMission(mission);
    } catch (error) {
      this.errors.push({
        action: 'mission',
        step: 'execute',
        message: (error as Error).message,
        details: error,
      });
    }

    return {
      success: this.errors.length === 0,
      duration: Date.now() - startTime,
      actionsRun: this.actionsRun,
      errors: this.errors,
      stores: this.ctx.stores,
    };
  }

  private async executeMission(mission: MissionDefinition): Promise<void> {
    this.log(`Executing mission: ${mission.name}`);

    // Initialize sources (HTTP clients)
    for (const source of mission.sources) {
      await this.initializeSource(source);
    }

    // Initialize stores
    for (const store of mission.stores) {
      await this.initializeStore(store);
    }

    // Build action lookup
    const actions = new Map<string, ActionDefinition>();
    for (const action of mission.actions) {
      actions.set(action.name, action);
    }

    // Execute pipeline
    for (const stage of mission.pipeline.stages) {
      const action = actions.get(stage.action);
      if (!action) {
        throw new Error(`Action not found: ${stage.action}`);
      }

      // Check condition if present
      if (stage.condition) {
        const shouldRun = evaluate(stage.condition, this.ctx);
        if (!shouldRun) {
          this.log(`Skipping action ${stage.action} (condition not met)`);
          continue;
        }
      }

      await this.executeAction(action);
      this.actionsRun.push(action.name);
    }
  }

  private async initializeSource(source: SourceDefinition): Promise<void> {
    const authConfig = this.config.auth?.[source.name];

    let authProvider;
    if (authConfig) {
      if (authConfig.type === 'bearer' && authConfig.token) {
        authProvider = new BearerAuthProvider(authConfig.token);
      } else if (authConfig.type === 'oauth2' && authConfig.accessToken) {
        authProvider = new OAuth2AuthProvider({
          accessToken: authConfig.accessToken,
          refreshToken: authConfig.refreshToken,
          tokenEndpoint: authConfig.tokenEndpoint,
          clientId: authConfig.clientId,
          clientSecret: authConfig.clientSecret,
        });
      }
    }

    const client = new HttpClient({
      baseUrl: source.config.base,
      auth: authProvider,
    });

    this.ctx.sources.set(source.name, client);
    this.log(`Initialized source: ${source.name}`);
  }

  private async initializeStore(store: StoreDefinition): Promise<void> {
    // Check for custom store adapter
    if (this.config.stores?.[store.name]) {
      this.ctx.stores.set(store.name, this.config.stores[store.name]);
    } else {
      // Default to memory store
      this.ctx.stores.set(store.name, new MemoryStore(store.target));
    }
    this.log(`Initialized store: ${store.name} (${store.storeType})`);
  }

  private async executeAction(action: ActionDefinition): Promise<void> {
    this.log(`Executing action: ${action.name}`);

    for (const step of action.steps) {
      await this.executeStep(step, action.name);
    }
  }

  private async executeStep(step: ActionStep, actionName: string): Promise<void> {
    try {
      switch (step.type) {
        case 'FetchStep':
          await this.executeFetch(step);
          break;
        case 'ForStep':
          await this.executeFor(step, actionName);
          break;
        case 'MapStep':
          await this.executeMap(step);
          break;
        case 'ValidateStep':
          await this.executeValidate(step);
          break;
        case 'StoreStep':
          await this.executeStore(step);
          break;
        default:
          throw new Error(`Unknown step type: ${(step as ActionStep).type}`);
      }
    } catch (error) {
      this.errors.push({
        action: actionName,
        step: step.type,
        message: (error as Error).message,
        details: error,
      });
      throw error;
    }
  }

  private async executeFetch(step: FetchStep): Promise<void> {
    // Get the source client
    const sourceName = step.source ?? this.ctx.sources.keys().next().value;
    const client = this.ctx.sources.get(sourceName!);

    if (!client) {
      throw new Error(`Source not found: ${sourceName}`);
    }

    // Evaluate and interpolate path
    let pathValue: string;
    if (step.path.type === 'Literal' && step.path.dataType === 'string') {
      pathValue = interpolatePath(step.path.value as string, this.ctx);
    } else {
      pathValue = String(evaluate(step.path, this.ctx));
    }

    this.log(`Fetching: ${step.method} ${pathValue}`);

    if (this.config.dryRun) {
      this.log('(dry run - skipping actual request)');
      this.ctx.response = { dryRun: true };
      return;
    }

    // Handle pagination
    if (step.paginate) {
      await this.executePaginatedFetch(step, client, pathValue);
    } else {
      const response = await client.request({
        method: step.method,
        path: pathValue,
        body: step.body ? evaluate(step.body, this.ctx) : undefined,
      }, step.retry);

      this.ctx.response = response.data;
    }
  }

  private async executePaginatedFetch(
    step: FetchStep,
    client: HttpClient,
    basePath: string
  ): Promise<void> {
    const allResults: unknown[] = [];
    let page = 0;
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const query: Record<string, string> = {};

      switch (step.paginate!.type) {
        case 'offset':
          query[step.paginate!.param] = String(page * step.paginate!.pageSize);
          break;
        case 'page':
          query[step.paginate!.param] = String(page + 1);
          break;
        case 'cursor':
          if (cursor) {
            query[step.paginate!.param] = cursor;
          }
          break;
      }

      this.log(`Fetching page ${page + 1}...`);

      const response = await client.request({
        method: step.method,
        path: basePath,
        query,
      }, step.retry);

      this.ctx.response = response.data;

      // Check until condition
      if (step.until) {
        const shouldStop = evaluate(step.until, this.ctx);
        if (shouldStop) {
          hasMore = false;
          break;
        }
      }

      // Extract results (assuming response has array)
      const data = response.data as Record<string, unknown>;
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          allResults.push(...(data[key] as unknown[]));
          if ((data[key] as unknown[]).length < step.paginate!.pageSize) {
            hasMore = false;
          }
          break;
        }
      }

      // Handle cursor pagination
      if (step.paginate!.type === 'cursor' && step.paginate!.cursorPath) {
        cursor = this.extractCursor(data, step.paginate!.cursorPath);
        if (!cursor) hasMore = false;
      }

      page++;

      // Safety limit
      if (page > 100) {
        this.log('Warning: pagination limit reached');
        hasMore = false;
      }
    }

    // Set combined results
    this.ctx.response = allResults;
    this.log(`Fetched ${allResults.length} total items`);
  }

  private extractCursor(data: Record<string, unknown>, path: string): string | undefined {
    const parts = path.split('.');
    let value: unknown = data;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value ? String(value) : undefined;
  }

  private async executeFor(step: ForStep, actionName: string): Promise<void> {
    // Get collection
    let collection: unknown[];

    if (step.collection.type === 'Identifier') {
      // It's a store reference
      const store = this.ctx.stores.get(step.collection.name);
      if (store) {
        collection = await store.list();
      } else {
        collection = (getVariable(this.ctx, step.collection.name) as unknown[]) ?? [];
      }
    } else {
      collection = evaluate(step.collection, this.ctx) as unknown[];
    }

    if (!Array.isArray(collection)) {
      throw new Error('For loop collection must be an array');
    }

    // Apply filter if present
    if (step.condition) {
      collection = collection.filter((item) => evaluate(step.condition!, this.ctx, item));
    }

    this.log(`Iterating over ${collection.length} items`);

    // Execute steps for each item
    for (const item of collection) {
      const childCtx = childContext(this.ctx);
      setVariable(childCtx, step.variable, item);

      // Temporarily use child context
      const parentCtx = this.ctx;
      this.ctx = childCtx;

      for (const innerStep of step.steps) {
        await this.executeStep(innerStep, actionName);
      }

      // Restore parent context
      this.ctx = parentCtx;
    }
  }

  private async executeMap(step: MapStep): Promise<void> {
    const source = evaluate(step.source, this.ctx) as Record<string, unknown>;

    const mapped: Record<string, unknown> = {};

    for (const mapping of step.mappings) {
      mapped[mapping.field] = evaluate(mapping.expression, this.ctx, source);
    }

    // Store mapped result in response for next step
    this.ctx.response = mapped;
    this.log(`Mapped to ${step.targetSchema}`);
  }

  private async executeValidate(step: ValidateStep): Promise<void> {
    const target = evaluate(step.target, this.ctx);

    for (const constraint of step.constraints) {
      const result = evaluate(constraint.condition, this.ctx, target);

      if (!result) {
        const message = constraint.message ?? `Validation failed: ${JSON.stringify(constraint.condition)}`;

        if (constraint.severity === 'error') {
          throw new Error(message);
        } else {
          this.log(`Warning: ${message}`);
        }
      }
    }

    this.log('Validation passed');
  }

  private async executeStore(step: StoreStep): Promise<void> {
    const store = this.ctx.stores.get(step.target);
    if (!store) {
      throw new Error(`Store not found: ${step.target}`);
    }

    const source = evaluate(step.source, this.ctx);

    if (Array.isArray(source)) {
      // Store each item
      for (const item of source) {
        const record = item as Record<string, unknown>;
        const key = step.options.key
          ? String(evaluate(step.options.key, this.ctx, record))
          : String(record.id ?? Math.random());

        if (step.options.partial !== undefined) {
          record._partial = step.options.partial;
        }

        if (step.options.upsert) {
          await store.update(key, record);
        } else {
          await store.set(key, record);
        }
      }
      this.log(`Stored ${source.length} items to ${step.target}`);
    } else {
      const record = source as Record<string, unknown>;
      const key = step.options.key
        ? String(evaluate(step.options.key, this.ctx, record))
        : String(record.id ?? Math.random());

      if (step.options.partial !== undefined) {
        record._partial = step.options.partial;
      }

      if (step.options.upsert) {
        await store.update(key, record);
      } else {
        await store.set(key, record);
      }
      this.log(`Stored item to ${step.target}`);
    }
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Reqon] ${message}`);
    }
  }
}
