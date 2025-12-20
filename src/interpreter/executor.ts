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
  RateLimitSourceConfig,
} from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import { createContext, childContext, setVariable, getVariable } from './context.js';
import { evaluate, interpolatePath } from './evaluator.js';
import { HttpClient, BearerAuthProvider, OAuth2AuthProvider } from './http.js';
import { createStore, resolveStoreType } from '../stores/index.js';
import type { StoreAdapter } from '../stores/types.js';
import { loadOAS, resolveOperation, getResponseSchema, validateResponse } from '../oas/index.js';
import type { OASSource } from '../oas/index.js';
import { AdaptiveRateLimiter } from '../auth/rate-limiter.js';
import type { RateLimiter, RateLimitCallbacks } from '../auth/types.js';
import {
  createExecutionState,
  findResumePoint,
  type ExecutionState,
  type ExecutionStore,
  FileExecutionStore,
} from '../execution/index.js';
import {
  generateCheckpointKey,
  formatSinceDate,
  type SyncStore,
  FileSyncStore,
} from '../sync/index.js';

export interface ExecutionResult {
  success: boolean;
  duration: number;
  actionsRun: string[];
  errors: ExecutionError[];
  stores: Map<string, StoreAdapter>;
  /** Execution ID for resuming */
  executionId?: string;
  /** Execution state (if persistence enabled) */
  state?: ExecutionState;
}

export interface ExecutionError {
  action: string;
  step: string;
  message: string;
  details?: unknown;
}

/** Event emitted when execution starts */
export interface ExecutionStartEvent {
  executionId: string;
  mission: string;
  stageCount: number;
  isResume: boolean;
  metadata?: Record<string, unknown>;
}

/** Event emitted when execution completes */
export interface ExecutionCompleteEvent {
  executionId: string;
  mission: string;
  success: boolean;
  duration: number;
  stagesCompleted: number;
  stagesFailed: number;
  errors: ExecutionError[];
}

/** Event emitted when a stage starts */
export interface StageStartEvent {
  executionId: string;
  mission: string;
  stageIndex: number;
  stageName: string;
  totalStages: number;
}

/** Event emitted when a stage completes */
export interface StageCompleteEvent {
  executionId: string;
  mission: string;
  stageIndex: number;
  stageName: string;
  totalStages: number;
  success: boolean;
  duration: number;
  error?: string;
}

/** Callbacks for execution progress */
export interface ProgressCallbacks {
  onExecutionStart?: (event: ExecutionStartEvent) => void;
  onExecutionComplete?: (event: ExecutionCompleteEvent) => void;
  onStageStart?: (event: StageStartEvent) => void;
  onStageComplete?: (event: StageCompleteEvent) => void;
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
  // Rate limit callbacks (optional)
  rateLimitCallbacks?: RateLimitCallbacks;
  // Development mode - use file stores instead of sql/nosql (default: true)
  developmentMode?: boolean;
  // Base directory for file stores (default: '.reqon-data')
  dataDir?: string;
  // Enable state persistence for resumable executions
  persistState?: boolean;
  // Custom execution store (defaults to FileExecutionStore)
  executionStore?: ExecutionStore;
  // Resume from a previous execution ID
  resumeFrom?: string;
  // Metadata to attach to execution state
  metadata?: Record<string, unknown>;
  // Custom sync store (defaults to FileSyncStore)
  syncStore?: SyncStore;
  // Progress callbacks for real-time UI updates
  progress?: ProgressCallbacks;
}

interface AuthConfig {
  type: 'bearer' | 'oauth2' | 'none';
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
  private oasSources: Map<string, OASSource> = new Map();
  private sourceConfigs: Map<string, SourceDefinition> = new Map();
  private rateLimiter: RateLimiter;
  private executionStore?: ExecutionStore;
  private executionState?: ExecutionState;
  private syncStore?: SyncStore;
  private missionName?: string;

  constructor(config: ExecutorConfig = {}) {
    this.config = config;
    this.ctx = createContext();
    this.rateLimiter = new AdaptiveRateLimiter();

    // Set up rate limit callbacks with default logging if verbose
    const callbacks: RateLimitCallbacks = config.rateLimitCallbacks ?? {};
    if (config.verbose && !callbacks.onRateLimited) {
      callbacks.onRateLimited = (event) => {
        console.log(
          `[Reqon] Rate limited on ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `waiting ${event.waitSeconds}s (strategy: ${event.strategy})`
        );
      };
    }
    if (config.verbose && !callbacks.onResumed) {
      callbacks.onResumed = (event) => {
        console.log(
          `[Reqon] Rate limit cleared for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} ` +
            `(waited ${event.waitedSeconds}s)`
        );
      };
    }
    if (config.verbose && !callbacks.onWaiting) {
      callbacks.onWaiting = (event) => {
        console.log(
          `[Reqon] Still waiting for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `${event.waitSeconds}s remaining (elapsed: ${event.elapsedSeconds}s)`
        );
      };
    }
    this.rateLimiter.setCallbacks(callbacks);

    // Initialize execution store if persistence enabled
    if (config.persistState) {
      this.executionStore = config.executionStore ?? new FileExecutionStore(
        `${config.dataDir ?? '.reqon-data'}/executions`
      );
    }
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

    // Initialize or resume execution state
    await this.initializeExecutionState(mission);

    try {
      await this.executeMission(mission);

      // Mark execution as completed
      if (this.executionState) {
        this.executionState.status = 'completed';
        this.executionState.completedAt = new Date();
        this.executionState.duration = Date.now() - startTime;
        await this.saveExecutionState();
      }
    } catch (error) {
      this.errors.push({
        action: 'mission',
        step: 'execute',
        message: (error as Error).message,
        details: error,
      });

      // Mark execution as failed
      if (this.executionState) {
        this.executionState.status = 'failed';
        this.executionState.completedAt = new Date();
        this.executionState.duration = Date.now() - startTime;
        await this.saveExecutionState();
      }
    }

    const duration = Date.now() - startTime;
    const success = this.errors.length === 0;

    // Emit onExecutionComplete callback
    const stagesCompleted = this.executionState?.stages.filter(s => s.status === 'completed').length ?? this.actionsRun.length;
    const stagesFailed = this.executionState?.stages.filter(s => s.status === 'failed').length ?? (success ? 0 : 1);

    this.config.progress?.onExecutionComplete?.({
      executionId: this.executionState?.id ?? 'ephemeral',
      mission: mission.name,
      success,
      duration,
      stagesCompleted,
      stagesFailed,
      errors: this.errors,
    });

    return {
      success,
      duration,
      actionsRun: this.actionsRun,
      errors: this.errors,
      stores: this.ctx.stores,
      executionId: this.executionState?.id,
      state: this.executionState,
    };
  }

  private async initializeExecutionState(mission: MissionDefinition): Promise<void> {
    let isResume = false;

    if (this.executionStore) {
      // Resume from previous execution?
      if (this.config.resumeFrom) {
        const previous = await this.executionStore.load(this.config.resumeFrom);
        if (previous) {
          this.executionState = previous;
          this.executionState.status = 'running';
          this.log(`Resuming execution ${previous.id} from previous run`);
          await this.saveExecutionState();
          isResume = true;
        } else {
          this.log(`Warning: Could not find execution ${this.config.resumeFrom} to resume`);
        }
      }

      if (!this.executionState) {
        // Create new execution state
        const stages = mission.pipeline.stages.map((s) => s.action);
        this.executionState = createExecutionState({
          mission: mission.name,
          stages,
          metadata: this.config.metadata,
        });
        this.executionState.status = 'running';
        await this.saveExecutionState();
        this.log(`Started execution ${this.executionState.id}`);
      }
    }

    // Emit onExecutionStart callback
    this.config.progress?.onExecutionStart?.({
      executionId: this.executionState?.id ?? 'ephemeral',
      mission: mission.name,
      stageCount: mission.pipeline.stages.length,
      isResume,
      metadata: this.config.metadata,
    });
  }

  private async saveExecutionState(): Promise<void> {
    if (this.executionStore && this.executionState) {
      await this.executionStore.save(this.executionState);
    }
  }

  private updateStageState(
    stageIndex: number,
    updates: Partial<{ status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; error?: string }>
  ): void {
    if (!this.executionState) return;

    const stage = this.executionState.stages[stageIndex];
    if (!stage) return;

    if (updates.status === 'running' && !stage.startedAt) {
      stage.startedAt = new Date();
    }
    if (updates.status === 'completed' || updates.status === 'failed') {
      stage.completedAt = new Date();
    }
    if (updates.status) {
      stage.status = updates.status;
    }
    if (updates.error) {
      stage.error = updates.error;
      this.executionState.errors.push({
        stageIndex,
        action: stage.action,
        step: 'unknown',
        message: updates.error,
        timestamp: new Date(),
        attempt: stage.attempt,
      });
    }
  }

  private async executeMission(mission: MissionDefinition): Promise<void> {
    this.log(`Executing mission: ${mission.name}`);
    this.missionName = mission.name;

    // Initialize sync store
    this.syncStore = this.config.syncStore ?? new FileSyncStore(
      mission.name,
      `${this.config.dataDir ?? '.reqon-data'}/sync`
    );

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

    // Determine resume point
    const resumeIndex = this.executionState ? findResumePoint(this.executionState) : 0;
    if (resumeIndex > 0) {
      this.log(`Resuming from stage ${resumeIndex} (${mission.pipeline.stages[resumeIndex]?.action})`);
    }

    // Execute pipeline
    for (let i = 0; i < mission.pipeline.stages.length; i++) {
      const stage = mission.pipeline.stages[i];
      const action = actions.get(stage.action);

      if (!action) {
        throw new Error(`Action not found: ${stage.action}`);
      }

      // Skip already completed stages when resuming
      if (i < resumeIndex) {
        this.log(`Skipping ${stage.action} (already completed)`);
        continue;
      }

      // Check condition if present
      if (stage.condition) {
        const shouldRun = evaluate(stage.condition, this.ctx);
        if (!shouldRun) {
          this.log(`Skipping action ${stage.action} (condition not met)`);
          this.updateStageState(i, { status: 'skipped' });
          await this.saveExecutionState();
          continue;
        }
      }

      // Update stage state to running
      this.updateStageState(i, { status: 'running' });
      await this.saveExecutionState();

      const stageStartTime = Date.now();

      // Emit onStageStart callback
      this.config.progress?.onStageStart?.({
        executionId: this.executionState?.id ?? 'ephemeral',
        mission: mission.name,
        stageIndex: i,
        stageName: stage.action,
        totalStages: mission.pipeline.stages.length,
      });

      try {
        await this.executeAction(action);
        this.actionsRun.push(action.name);

        // Mark stage as completed
        this.updateStageState(i, { status: 'completed' });
        await this.saveExecutionState();

        // Emit onStageComplete callback (success)
        this.config.progress?.onStageComplete?.({
          executionId: this.executionState?.id ?? 'ephemeral',
          mission: mission.name,
          stageIndex: i,
          stageName: stage.action,
          totalStages: mission.pipeline.stages.length,
          success: true,
          duration: Date.now() - stageStartTime,
        });
      } catch (error) {
        // Mark stage as failed
        this.updateStageState(i, {
          status: 'failed',
          error: (error as Error).message,
        });
        await this.saveExecutionState();

        // Emit onStageComplete callback (failure)
        this.config.progress?.onStageComplete?.({
          executionId: this.executionState?.id ?? 'ephemeral',
          mission: mission.name,
          stageIndex: i,
          stageName: stage.action,
          totalStages: mission.pipeline.stages.length,
          success: false,
          duration: Date.now() - stageStartTime,
          error: (error as Error).message,
        });

        throw error; // Re-throw to stop execution
      }
    }
  }

  private async initializeSource(source: SourceDefinition): Promise<void> {
    // Store source config for later reference
    this.sourceConfigs.set(source.name, source);

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

    // If source has OAS spec, load it
    let baseUrl = source.config.base;
    if (source.specPath) {
      try {
        const oasSource = await loadOAS(source.specPath);
        this.oasSources.set(source.name, oasSource);
        // Use base URL from OAS if not explicitly provided
        if (!baseUrl) {
          baseUrl = oasSource.baseUrl;
        }
        this.log(`Loaded OAS spec for ${source.name}: ${oasSource.operations.size} operations`);
      } catch (error) {
        throw new Error(`Failed to load OAS spec for ${source.name}: ${(error as Error).message}`);
      }
    }

    if (!baseUrl) {
      throw new Error(`Source ${source.name} has no base URL (provide 'base' or OAS spec with servers)`);
    }

    // Configure rate limiter for this source
    if (source.config.rateLimit) {
      this.rateLimiter.configure(source.name, {
        strategy: source.config.rateLimit.strategy,
        maxWait: source.config.rateLimit.maxWait,
        fallbackRpm: source.config.rateLimit.fallbackRpm,
      });
      this.log(
        `Rate limit config for ${source.name}: strategy=${source.config.rateLimit.strategy ?? 'pause'}, ` +
          `maxWait=${source.config.rateLimit.maxWait ?? 300}s`
      );
    }

    const client = new HttpClient({
      baseUrl,
      auth: authProvider,
      rateLimiter: this.rateLimiter,
      sourceName: source.name,
    });

    this.ctx.sources.set(source.name, client);
    this.log(`Initialized source: ${source.name}`);
  }

  private async initializeStore(store: StoreDefinition): Promise<void> {
    // Check for custom store adapter
    if (this.config.stores?.[store.name]) {
      this.ctx.stores.set(store.name, this.config.stores[store.name]);
      this.log(`Initialized store: ${store.name} (custom adapter)`);
      return;
    }

    // Use store factory to create appropriate adapter
    const developmentMode = this.config.developmentMode ?? true;
    const storeType = resolveStoreType(store.storeType, developmentMode);

    const adapter = createStore({
      type: storeType,
      name: store.target,
      baseDir: this.config.dataDir,
    });

    this.ctx.stores.set(store.name, adapter);
    this.log(`Initialized store: ${store.name} (${storeType}${storeType !== store.storeType ? ` <- ${store.storeType}` : ''})`);
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
    let sourceName: string;
    let method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    let pathValue: string;
    let operationId: string | undefined;

    // Resolve method and path - either from operationRef or explicit values
    if (step.operationRef) {
      // OAS-style: resolve from operationId
      sourceName = step.operationRef.source;
      operationId = step.operationRef.operationId;

      const oasSource = this.oasSources.get(sourceName);
      if (!oasSource) {
        throw new Error(`Source '${sourceName}' does not have an OAS spec. Use 'source ${sourceName} from "spec.yaml"'`);
      }

      const operation = resolveOperation(oasSource, operationId);
      method = operation.method;
      pathValue = interpolatePath(operation.path, this.ctx);

      this.log(`Fetching: ${sourceName}.${operationId} -> ${method} ${pathValue}`);
    } else {
      // Traditional: explicit method + path
      sourceName = step.source ?? this.ctx.sources.keys().next().value!;
      method = step.method!;

      if (step.path!.type === 'Literal' && step.path!.dataType === 'string') {
        pathValue = interpolatePath(step.path!.value as string, this.ctx);
      } else {
        pathValue = String(evaluate(step.path!, this.ctx));
      }

      this.log(`Fetching: ${method} ${pathValue}`);
    }

    const client = this.ctx.sources.get(sourceName);
    if (!client) {
      throw new Error(`Source not found: ${sourceName}`);
    }

    // Resolve "since" query parameter for incremental sync
    let sinceQuery: Record<string, string> = {};
    let checkpointKey: string | undefined;

    if (step.since && this.syncStore) {
      checkpointKey = step.since.key ?? generateCheckpointKey(sourceName, operationId, pathValue);

      if (step.since.type === 'lastSync') {
        const lastSync = await this.syncStore.getLastSync(checkpointKey);
        const paramName = step.since.param ?? 'since';
        const format = step.since.format ?? 'iso';
        sinceQuery[paramName] = formatSinceDate(lastSync, format);
        this.log(`Incremental sync: ${paramName}=${sinceQuery[paramName]} (key: ${checkpointKey})`);
      } else if (step.since.type === 'expression' && step.since.expression) {
        const value = evaluate(step.since.expression, this.ctx);
        const paramName = step.since.param ?? 'since';
        sinceQuery[paramName] = String(value);
      }
    }

    if (this.config.dryRun) {
      this.log('(dry run - skipping actual request)');
      this.ctx.response = { dryRun: true };
      return;
    }

    // Handle pagination
    if (step.paginate) {
      await this.executePaginatedFetch(step, client, pathValue, method, sourceName, operationId, sinceQuery);
    } else {
      const response = await client.request({
        method,
        path: pathValue,
        query: Object.keys(sinceQuery).length > 0 ? sinceQuery : undefined,
        body: step.body ? evaluate(step.body, this.ctx) : undefined,
      }, step.retry);

      // Validate response against OAS schema if enabled
      await this.validateOASResponse(sourceName, operationId, response.data);

      this.ctx.response = response.data;

      // Update sync checkpoint after successful fetch
      if (checkpointKey && this.syncStore) {
        await this.recordSyncCheckpoint(checkpointKey, step, response.data);
      }
    }
  }

  private async recordSyncCheckpoint(
    key: string,
    step: FetchStep,
    data: unknown
  ): Promise<void> {
    if (!this.syncStore) return;

    let syncedAt = new Date();

    // If updateFrom is specified, extract the timestamp from response
    if (step.since?.updateFrom && data && typeof data === 'object') {
      const parts = step.since.updateFrom.split('.');
      let value: unknown = data;
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        }
      }
      if (value instanceof Date) {
        syncedAt = value;
      } else if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          syncedAt = parsed;
        }
      }
    }

    // Count records if response is an array
    let recordCount: number | undefined;
    if (Array.isArray(data)) {
      recordCount = data.length;
    } else if (data && typeof data === 'object') {
      // Look for array in response
      for (const val of Object.values(data)) {
        if (Array.isArray(val)) {
          recordCount = val.length;
          break;
        }
      }
    }

    await this.syncStore.recordSync({
      key,
      syncedAt,
      recordCount,
      mission: this.missionName,
      executionId: this.executionState?.id,
    });

    this.log(`Recorded sync checkpoint: ${key} at ${syncedAt.toISOString()}`);
  }

  private async validateOASResponse(
    sourceName: string,
    operationId: string | undefined,
    data: unknown
  ): Promise<void> {
    if (!operationId) return;

    const sourceConfig = this.sourceConfigs.get(sourceName);
    if (!sourceConfig?.config.validateResponses) return;

    const oasSource = this.oasSources.get(sourceName);
    if (!oasSource) return;

    const schema = getResponseSchema(oasSource, operationId);
    if (!schema) {
      this.log(`No response schema found for ${operationId}`);
      return;
    }

    const result = validateResponse(data, schema);
    if (!result.valid) {
      const errorMessages = result.errors.map(e => `  ${e.path}: ${e.message}`).join('\n');
      this.log(`Response validation warnings for ${operationId}:\n${errorMessages}`);
    }
  }

  private async executePaginatedFetch(
    step: FetchStep,
    client: HttpClient,
    basePath: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    sourceName: string,
    operationId?: string,
    sinceQuery: Record<string, string> = {}
  ): Promise<void> {
    const allResults: unknown[] = [];
    let page = 0;
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const query: Record<string, string> = { ...sinceQuery };

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
        method,
        path: basePath,
        query,
      }, step.retry);

      // Validate response against OAS schema if enabled
      await this.validateOASResponse(sourceName, operationId, response.data);

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
