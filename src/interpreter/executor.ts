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
  PipelineStage,
  SourceDefinition,
  StoreDefinition,
  FieldMapping,
  RateLimitSourceConfig,
} from '../ast/nodes.js';
import { isParallelStage, getStageActions } from '../ast/nodes.js';
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
import { FetchHandler } from './fetch-handler.js';
import { ForHandler, MapHandler, ValidateHandler, StoreHandler } from './step-handlers/index.js';

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
        const stages = mission.pipeline.stages.map((s) => this.getStageName(s));
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
      const resumeStage = mission.pipeline.stages[resumeIndex];
      const stageName = this.getStageName(resumeStage);
      this.log(`Resuming from stage ${resumeIndex} (${stageName})`);
    }

    // Execute pipeline
    for (let i = 0; i < mission.pipeline.stages.length; i++) {
      const stage = mission.pipeline.stages[i];

      // Skip already completed stages when resuming
      if (i < resumeIndex) {
        this.log(`Skipping ${this.getStageName(stage)} (already completed)`);
        continue;
      }

      // Check condition if present
      if (stage.condition) {
        const shouldRun = evaluate(stage.condition, this.ctx);
        if (!shouldRun) {
          this.log(`Skipping ${this.getStageName(stage)} (condition not met)`);
          this.updateStageState(i, { status: 'skipped' });
          await this.saveExecutionState();
          continue;
        }
      }

      // Execute stage (parallel or sequential)
      if (isParallelStage(stage)) {
        await this.executeParallelStage(i, stage, actions, mission);
      } else if (stage.action) {
        await this.executeSequentialStage(i, stage.action, actions, mission);
      }
    }
  }

  private getStageName(stage: PipelineStage): string {
    if (isParallelStage(stage)) {
      return `[${stage.actions.join(', ')}]`;
    }
    return stage.action ?? 'unknown';
  }

  private async executeSequentialStage(
    stageIndex: number,
    actionName: string,
    actions: Map<string, ActionDefinition>,
    mission: MissionDefinition
  ): Promise<void> {
    const action = actions.get(actionName);
    if (!action) {
      throw new Error(`Action not found: ${actionName}`);
    }

    // Update stage state to running
    this.updateStageState(stageIndex, { status: 'running' });
    await this.saveExecutionState();

    const stageStartTime = Date.now();

    // Emit onStageStart callback
    this.config.progress?.onStageStart?.({
      executionId: this.executionState?.id ?? 'ephemeral',
      mission: mission.name,
      stageIndex,
      stageName: actionName,
      totalStages: mission.pipeline.stages.length,
    });

    try {
      await this.executeAction(action);
      this.actionsRun.push(action.name);

      // Mark stage as completed
      this.updateStageState(stageIndex, { status: 'completed' });
      await this.saveExecutionState();

      // Emit onStageComplete callback (success)
      this.config.progress?.onStageComplete?.({
        executionId: this.executionState?.id ?? 'ephemeral',
        mission: mission.name,
        stageIndex,
        stageName: actionName,
        totalStages: mission.pipeline.stages.length,
        success: true,
        duration: Date.now() - stageStartTime,
      });
    } catch (error) {
      // Mark stage as failed
      this.updateStageState(stageIndex, {
        status: 'failed',
        error: (error as Error).message,
      });
      await this.saveExecutionState();

      // Emit onStageComplete callback (failure)
      this.config.progress?.onStageComplete?.({
        executionId: this.executionState?.id ?? 'ephemeral',
        mission: mission.name,
        stageIndex,
        stageName: actionName,
        totalStages: mission.pipeline.stages.length,
        success: false,
        duration: Date.now() - stageStartTime,
        error: (error as Error).message,
      });

      throw error; // Re-throw to stop execution
    }
  }

  private async executeParallelStage(
    stageIndex: number,
    stage: PipelineStage & { actions: string[] },
    actions: Map<string, ActionDefinition>,
    mission: MissionDefinition
  ): Promise<void> {
    const actionNames = stage.actions;
    const stageName = `[${actionNames.join(', ')}]`;

    // Validate all actions exist
    const actionDefs: ActionDefinition[] = [];
    for (const name of actionNames) {
      const action = actions.get(name);
      if (!action) {
        throw new Error(`Action not found: ${name}`);
      }
      actionDefs.push(action);
    }

    // Update stage state to running
    this.updateStageState(stageIndex, { status: 'running' });
    await this.saveExecutionState();

    const stageStartTime = Date.now();

    // Emit onStageStart callback
    this.config.progress?.onStageStart?.({
      executionId: this.executionState?.id ?? 'ephemeral',
      mission: mission.name,
      stageIndex,
      stageName,
      totalStages: mission.pipeline.stages.length,
    });

    this.log(`Executing parallel stage: ${stageName}`);

    try {
      // Execute all actions in parallel
      const results = await Promise.allSettled(
        actionDefs.map(action => this.executeAction(action))
      );

      // Check for failures
      const failures: { name: string; error: Error }[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          this.actionsRun.push(actionDefs[i].name);
        } else {
          failures.push({ name: actionDefs[i].name, error: result.reason });
        }
      }

      if (failures.length > 0) {
        const errorMsg = failures.map(f => `${f.name}: ${f.error.message}`).join('; ');
        throw new Error(`Parallel stage failed: ${errorMsg}`);
      }

      // Mark stage as completed
      this.updateStageState(stageIndex, { status: 'completed' });
      await this.saveExecutionState();

      // Emit onStageComplete callback (success)
      this.config.progress?.onStageComplete?.({
        executionId: this.executionState?.id ?? 'ephemeral',
        mission: mission.name,
        stageIndex,
        stageName,
        totalStages: mission.pipeline.stages.length,
        success: true,
        duration: Date.now() - stageStartTime,
      });
    } catch (error) {
      // Mark stage as failed
      this.updateStageState(stageIndex, {
        status: 'failed',
        error: (error as Error).message,
      });
      await this.saveExecutionState();

      // Emit onStageComplete callback (failure)
      this.config.progress?.onStageComplete?.({
        executionId: this.executionState?.id ?? 'ephemeral',
        mission: mission.name,
        stageIndex,
        stageName,
        totalStages: mission.pipeline.stages.length,
        success: false,
        duration: Date.now() - stageStartTime,
        error: (error as Error).message,
      });

      throw error; // Re-throw to stop execution
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

  private async executeStep(step: ActionStep, actionName: string, ctx?: ExecutionContext): Promise<void> {
    // Use provided context or default to this.ctx
    const execCtx = ctx ?? this.ctx;
    const originalCtx = this.ctx;

    // Temporarily use the provided context
    if (ctx) {
      this.ctx = ctx;
    }

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
    } finally {
      // Restore original context
      if (ctx) {
        this.ctx = originalCtx;
      }
    }
  }

  private async executeFetch(step: FetchStep): Promise<void> {
    const fetchHandler = new FetchHandler({
      ctx: this.ctx,
      oasSources: this.oasSources,
      sourceConfigs: this.sourceConfigs,
      syncStore: this.syncStore,
      missionName: this.missionName,
      executionId: this.executionState?.id,
      dryRun: this.config.dryRun,
      log: (msg) => this.log(msg),
    });

    const result = await fetchHandler.execute(step);
    this.ctx.response = result.data;

    // Update sync checkpoint after successful fetch
    if (result.checkpointKey && this.syncStore) {
      await fetchHandler.recordCheckpoint(result.checkpointKey, step, result.data);
    }
  }

  private async executeFor(step: ForStep, actionName: string): Promise<void> {
    const handler = new ForHandler({
      ctx: this.ctx,
      log: (msg) => this.log(msg),
      executeStep: (s, a, c) => this.executeStep(s, a, c),
      actionName,
    });
    await handler.execute(step);
  }

  private async executeMap(step: MapStep): Promise<void> {
    const handler = new MapHandler({
      ctx: this.ctx,
      log: (msg) => this.log(msg),
    });
    await handler.execute(step);
  }

  private async executeValidate(step: ValidateStep): Promise<void> {
    const handler = new ValidateHandler({
      ctx: this.ctx,
      log: (msg) => this.log(msg),
    });
    await handler.execute(step);
  }

  private async executeStore(step: StoreStep): Promise<void> {
    const handler = new StoreHandler({
      ctx: this.ctx,
      log: (msg) => this.log(msg),
    });
    await handler.execute(step);
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Reqon] ${message}`);
    }
  }
}
