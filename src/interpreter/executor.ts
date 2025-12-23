import type { Expression, SchemaDefinition } from 'vague-lang';
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
  MatchStep,
  LetStep,
  ApplyStep,
  TransformDefinition,
  WebhookStep,
  PipelineDefinition,
  PipelineStage,
} from '../ast/nodes.js';
import { isParallelStage } from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import { createContext, childContext, setVariable, getVariable } from './context.js';
import { evaluate } from './evaluator.js';
import type { StoreAdapter } from '../stores/types.js';
import type { OASSource } from '../oas/index.js';
import { SourceManager, type AuthConfig } from './source-manager.js';
import { StoreManager } from './store-manager.js';
import { AdaptiveRateLimiter } from '../auth/rate-limiter.js';
import { CircuitBreaker, type CircuitBreakerCallbacks } from '../auth/circuit-breaker.js';
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
import {
  ForHandler,
  MapHandler,
  ValidateHandler,
  StoreHandler,
  MatchHandler,
  ApplyHandler,
  WebhookHandler,
  SkipSignal,
  AbortError,
  RetrySignal,
  JumpSignal,
  QueueSignal,
} from './step-handlers/index.js';
import type { WebhookServer } from '../webhook/index.js';
import type {
  EventEmitter,
  StepType,
  StructuredLogger,
} from '../observability/index.js';
import { createEmitter, createStructuredLogger } from '../observability/index.js';
import type { DebugController, DebugSnapshot, DebugLocation, DebugPauseReason, DebugCommand } from '../debug/index.js';

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
  // Mission file directory (for resolving relative paths like OAS specs)
  missionDir?: string;
  // Rate limit callbacks (optional)
  rateLimitCallbacks?: RateLimitCallbacks;
  // Circuit breaker callbacks (optional)
  circuitBreakerCallbacks?: CircuitBreakerCallbacks;
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
  // Webhook server for handling wait steps
  webhookServer?: WebhookServer;
  // Event emitter for observability
  eventEmitter?: EventEmitter;
  // Structured logger (defaults to console if verbose)
  logger?: StructuredLogger;
  // Debug controller for step-through debugging
  debugController?: DebugController;
}

// AuthConfig is now exported from source-manager.ts
export { type AuthConfig } from './source-manager.js';

export class MissionExecutor {
  private config: ExecutorConfig;
  private ctx: ExecutionContext;
  private errors: ExecutionError[] = [];
  private actionsRun: string[] = [];
  private transforms: Map<string, TransformDefinition> = new Map();
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private sourceManager: SourceManager;
  private storeManager: StoreManager;
  private executionStore?: ExecutionStore;
  private executionState?: ExecutionState;
  private syncStore?: SyncStore;
  private missionName?: string;
  private eventEmitter?: EventEmitter;
  private logger?: StructuredLogger;
  private stepIndex = 0;
  private debugController?: DebugController;

  constructor(config: ExecutorConfig = {}) {
    this.config = config;
    this.ctx = createContext();
    this.rateLimiter = new AdaptiveRateLimiter();
    this.circuitBreaker = new CircuitBreaker();

    // Initialize managers (logger set after verbose callbacks configured)
    this.sourceManager = new SourceManager(
      { auth: config.auth, missionDir: config.missionDir },
      { rateLimiter: this.rateLimiter, circuitBreaker: this.circuitBreaker }
    );
    this.storeManager = new StoreManager({
      customStores: config.stores,
      developmentMode: config.developmentMode,
      dataDir: config.dataDir,
    });

    // Set up rate limit callbacks with default logging if verbose
    const callbacks: RateLimitCallbacks = config.rateLimitCallbacks ?? {};
    if (config.verbose && !callbacks.onRateLimited) {
      callbacks.onRateLimited = (event) => {
        this.log(
          `Rate limited on ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `waiting ${event.waitSeconds}s (strategy: ${event.strategy})`
        );
      };
    }
    if (config.verbose && !callbacks.onResumed) {
      callbacks.onResumed = (event) => {
        this.log(
          `Rate limit cleared for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} ` +
            `(waited ${event.waitedSeconds}s)`
        );
      };
    }
    if (config.verbose && !callbacks.onWaiting) {
      callbacks.onWaiting = (event) => {
        this.log(
          `Still waiting for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `${event.waitSeconds}s remaining (elapsed: ${event.elapsedSeconds}s)`
        );
      };
    }
    this.rateLimiter.setCallbacks(callbacks);

    // Set up circuit breaker callbacks with default logging if verbose
    const cbCallbacks: CircuitBreakerCallbacks = config.circuitBreakerCallbacks ?? {};
    if (config.verbose && !cbCallbacks.onOpen) {
      cbCallbacks.onOpen = (event) => {
        this.log(
          `Circuit breaker OPEN for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `${event.failures} failures (${event.reason ?? 'threshold exceeded'})`
        );
      };
    }
    if (config.verbose && !cbCallbacks.onHalfOpen) {
      cbCallbacks.onHalfOpen = (event) => {
        this.log(
          `Circuit breaker HALF-OPEN for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `testing recovery`
        );
      };
    }
    if (config.verbose && !cbCallbacks.onClose) {
      cbCallbacks.onClose = (event) => {
        this.log(
          `Circuit breaker CLOSED for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `recovery successful`
        );
      };
    }
    if (config.verbose && !cbCallbacks.onRejected) {
      cbCallbacks.onRejected = (event) => {
        this.log(
          `Request REJECTED by circuit breaker for ${event.source}${event.endpoint ? `:${event.endpoint}` : ''} - ` +
            `retry in ${Math.ceil(event.nextAttemptIn / 1000)}s`
        );
      };
    }
    this.circuitBreaker.setCallbacks(cbCallbacks);

    // Initialize execution store if persistence enabled
    if (config.persistState) {
      this.executionStore = config.executionStore ?? new FileExecutionStore(
        `${config.dataDir ?? '.reqon-data'}/executions`
      );
    }

    // Initialize event emitter if provided
    this.eventEmitter = config.eventEmitter;

    // Initialize logger if verbose or provided
    if (config.logger) {
      this.logger = config.logger;
    } else if (config.verbose) {
      this.logger = createStructuredLogger({
        prefix: 'Reqon',
        level: 'debug',
        context: {},
      });
    }

    // Update managers with log function now that logger is configured
    this.sourceManager = new SourceManager(
      { auth: config.auth, missionDir: config.missionDir, log: (msg) => this.log(msg) },
      { rateLimiter: this.rateLimiter, circuitBreaker: this.circuitBreaker }
    );
    this.storeManager = new StoreManager({
      customStores: config.stores,
      developmentMode: config.developmentMode,
      dataDir: config.dataDir,
      log: (msg) => this.log(msg),
    });

    // Initialize debug controller if provided
    this.debugController = config.debugController;
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

    // Emit onExecutionComplete callback - count stages in a single pass
    const stageCounts = this.executionState?.stages.reduce(
      (acc, s) => {
        if (s.status === 'completed') acc.completed++;
        else if (s.status === 'failed') acc.failed++;
        return acc;
      },
      { completed: 0, failed: 0 }
    );
    const stagesCompleted = stageCounts?.completed ?? this.actionsRun.length;
    const stagesFailed = stageCounts?.failed ?? (success ? 0 : 1);

    this.config.progress?.onExecutionComplete?.({
      executionId: this.executionState?.id ?? 'ephemeral',
      mission: mission.name,
      success,
      duration,
      stagesCompleted,
      stagesFailed,
      errors: this.errors,
    });

    // Emit mission.complete or mission.failed event
    if (success) {
      this.eventEmitter?.emit('mission.complete', {
        success: true,
        stagesCompleted,
        stagesFailed,
        stagesSkipped: this.executionState?.stages.filter(s => s.status === 'skipped').length ?? 0,
        errorCount: this.errors.length,
      });
    } else {
      const failedStage = this.executionState?.stages.find(s => s.status === 'failed');
      this.eventEmitter?.emit('mission.failed', {
        error: this.errors[0]?.message ?? 'Unknown error',
        failedStage: failedStage?.action,
        stagesCompleted,
      });
    }

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

    // Emit mission.start event
    this.eventEmitter?.emit('mission.start', {
      stageCount: mission.pipeline.stages.length,
      isResume,
      resumeFromStage: isResume ? findResumePoint(this.executionState!) : undefined,
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

    // Initialize sources using SourceManager
    await this.sourceManager.initializeSources(mission.sources, this.ctx);

    // Initialize stores using StoreManager
    await this.storeManager.initializeStores(mission.stores, this.ctx);

    // Initialize schemas (for match step schema matching)
    for (const schema of mission.schemas) {
      this.ctx.schemas.set(schema.name, schema);
      this.log(`Registered schema: ${schema.name}`);
    }

    // Initialize transforms
    for (const transform of mission.transforms) {
      this.transforms.set(transform.name, transform);
      this.log(`Registered transform: ${transform.name}`);
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

    // Emit stage.start event
    this.eventEmitter?.emit('stage.start', {
      stageIndex,
      stageName: actionName,
      totalStages: mission.pipeline.stages.length,
      isParallel: false,
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

      // Emit stage.complete event
      this.eventEmitter?.emit('stage.complete', {
        stageIndex,
        stageName: actionName,
        success: true,
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

      // Emit stage.complete event (failure)
      this.eventEmitter?.emit('stage.complete', {
        stageIndex,
        stageName: actionName,
        success: false,
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

    // Emit stage.start event (parallel)
    this.eventEmitter?.emit('stage.start', {
      stageIndex,
      stageName,
      totalStages: mission.pipeline.stages.length,
      isParallel: true,
      parallelActions: actionNames,
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

      // Emit stage.complete event (success)
      this.eventEmitter?.emit('stage.complete', {
        stageIndex,
        stageName,
        success: true,
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

      // Emit stage.complete event (failure)
      this.eventEmitter?.emit('stage.complete', {
        stageIndex,
        stageName,
        success: false,
        error: (error as Error).message,
      });

      throw error; // Re-throw to stop execution
    }
  }

  private async executeAction(action: ActionDefinition): Promise<void> {
    this.log(`Executing action: ${action.name}`);

    // Create a child context for this action with its own response scope
    // This allows parallel actions to have independent response values
    const actionCtx = childContext(this.ctx);

    for (const step of action.steps) {
      await this.executeStep(step, action.name, actionCtx);
    }
  }

  private async executeStep(step: ActionStep, actionName: string, ctx?: ExecutionContext): Promise<void> {
    // Use provided context or default to this.ctx
    // NOTE: ctx is used for action-scoped operations (response, variables)
    // this.ctx is still used for mission-level resources (stores, sources)
    const execCtx = ctx ?? this.ctx;

    // Track step index for events
    const currentStepIndex = this.stepIndex++;
    const stepType = this.getStepType(step.type);

    // Emit step.start event
    this.eventEmitter?.emit('step.start', {
      actionName,
      stepIndex: currentStepIndex,
      stepType,
    });

    const stepStartTime = Date.now();

    // Debug pause point - before executing step
    if (this.debugController) {
      const location: DebugLocation = {
        action: actionName,
        stepIndex: currentStepIndex,
        stepType,
      };
      if (this.debugController.shouldPause(location)) {
        const snapshot = this.captureDebugSnapshot(actionName, currentStepIndex, stepType, { type: 'step' }, execCtx);
        const command = await this.debugController.pause(snapshot);
        this.handleDebugCommand(command);
      }
    }

    try {
      switch (step.type) {
        case 'FetchStep':
          await this.executeFetch(step, execCtx);
          break;
        case 'ForStep':
          await this.executeFor(step, actionName, execCtx);
          break;
        case 'MapStep':
          await this.executeMap(step, execCtx);
          break;
        case 'ValidateStep':
          await this.executeValidate(step, execCtx);
          break;
        case 'StoreStep':
          await this.executeStore(step, execCtx);
          break;
        case 'MatchStep':
          await this.executeMatch(step, actionName, execCtx);
          break;
        case 'LetStep':
          await this.executeLet(step, execCtx);
          break;
        case 'ApplyStep':
          await this.executeApply(step, execCtx);
          break;
        case 'WebhookStep':
          await this.executeWebhook(step, execCtx);
          break;
        default:
          throw new Error(`Unknown step type: ${(step as ActionStep).type}`);
      }

      // Emit step.complete event (success)
      this.eventEmitter?.emit('step.complete', {
        actionName,
        stepIndex: currentStepIndex,
        stepType,
        success: true,
      });
    } catch (error) {
      // Re-throw flow control signals without recording as errors
      if (
        error instanceof SkipSignal ||
        error instanceof RetrySignal ||
        error instanceof JumpSignal ||
        error instanceof QueueSignal
      ) {
        // Emit step.complete for flow control (not an error)
        this.eventEmitter?.emit('step.complete', {
          actionName,
          stepIndex: currentStepIndex,
          stepType,
          success: true, // Flow control is not a failure
        });
        throw error;
      }

      // Emit step.complete event (failure)
      this.eventEmitter?.emit('step.complete', {
        actionName,
        stepIndex: currentStepIndex,
        stepType,
        success: false,
        error: (error as Error).message,
      });

      // AbortError is a controlled abort, still record it
      this.errors.push({
        action: actionName,
        step: step.type,
        message: (error as Error).message,
        details: error,
      });
      throw error;
    }
  }

  private async executeFetch(step: FetchStep, ctx: ExecutionContext): Promise<void> {
    const fetchHandler = new FetchHandler({
      ctx,
      oasSources: this.sourceManager.getAllOASSources(),
      sourceConfigs: this.sourceManager.getAllSourceConfigs(),
      syncStore: this.syncStore,
      missionName: this.missionName,
      executionId: this.executionState?.id,
      dryRun: this.config.dryRun,
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
    });

    const result = await fetchHandler.execute(step);
    ctx.response = result.data;

    // Update sync checkpoint after successful fetch
    if (result.checkpointKey && this.syncStore) {
      await fetchHandler.recordCheckpoint(result.checkpointKey, step, result.data);
    }
  }

  private async executeFor(step: ForStep, actionName: string, ctx: ExecutionContext): Promise<void> {
    const handler = new ForHandler({
      ctx,
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
      executeStep: (s, a, c) => this.executeStep(s, a, c),
      actionName,
      debugController: this.debugController,
      captureDebugSnapshot: this.debugController
        ? (action, stepIndex, stepType, pauseReason, ctx) =>
            this.captureDebugSnapshot(action, stepIndex, stepType, pauseReason, ctx)
        : undefined,
      handleDebugCommand: this.debugController
        ? (cmd) => this.handleDebugCommand(cmd as DebugCommand)
        : undefined,
    });
    await handler.execute(step);
  }

  private async executeMap(step: MapStep, ctx: ExecutionContext): Promise<void> {
    const handler = new MapHandler({
      ctx,
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
    });
    await handler.execute(step);
  }

  private async executeValidate(step: ValidateStep, ctx: ExecutionContext): Promise<void> {
    const handler = new ValidateHandler({
      ctx,
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
    });
    await handler.execute(step);
  }

  private async executeStore(step: StoreStep, ctx: ExecutionContext): Promise<void> {
    const handler = new StoreHandler({
      ctx,
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
    });
    await handler.execute(step);
  }

  private async executeMatch(step: MatchStep, actionName: string, ctx: ExecutionContext): Promise<void> {
    const handler = new MatchHandler({
      ctx,
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
      executeStep: (s, a, c) => this.executeStep(s, a, c),
      actionName,
      debugController: this.debugController,
      captureDebugSnapshot: this.debugController
        ? (action, stepIndex, stepType, pauseReason, execCtx) =>
            this.captureDebugSnapshot(action, stepIndex, stepType, pauseReason, execCtx)
        : undefined,
      handleDebugCommand: this.debugController
        ? (cmd) => this.handleDebugCommand(cmd as DebugCommand)
        : undefined,
    });
    await handler.execute(step);
    // Flow control signals (SkipSignal, RetrySignal, etc.) will propagate up
  }

  private async executeLet(step: LetStep, ctx: ExecutionContext): Promise<void> {
    const value = evaluate(step.value, ctx);
    setVariable(ctx, step.name, value);
    this.log(`Set variable '${step.name}' = ${JSON.stringify(value)}`);
  }

  private async executeApply(step: ApplyStep, ctx: ExecutionContext): Promise<void> {
    const transform = this.transforms.get(step.transform);
    if (!transform) {
      throw new Error(`Transform '${step.transform}' not found`);
    }

    const handler = new ApplyHandler({
      ctx,
      log: (msg) => this.log(msg),
      transform,
    });
    await handler.execute(step);
  }

  private async executeWebhook(step: WebhookStep, ctx: ExecutionContext): Promise<void> {
    if (!this.config.webhookServer) {
      throw new Error(
        'Webhook server not configured. Use --webhook flag or configure webhookServer in executor config.'
      );
    }

    const handler = new WebhookHandler({
      ctx,
      webhookServer: this.config.webhookServer,
      executionId: this.executionState?.id ?? 'ephemeral',
      log: (msg) => this.log(msg),
      emit: this.eventEmitter ? (type, payload) => this.eventEmitter!.emit(type, payload) : undefined,
    });
    await handler.execute(step);
  }

  private log(message: string): void {
    if (this.logger) {
      this.logger.info(message);
    } else if (this.config.verbose) {
      console.log(`[Reqon] ${message}`);
    }
  }

  private getStepType(stepType: string): StepType {
    const mapping: Record<string, StepType> = {
      FetchStep: 'fetch',
      ForStep: 'for',
      MapStep: 'map',
      ValidateStep: 'validate',
      StoreStep: 'store',
      MatchStep: 'match',
      LetStep: 'let',
      WebhookStep: 'webhook',
    };
    return mapping[stepType] ?? 'fetch';
  }

  /** Get the event emitter (for external access) */
  getEventEmitter(): EventEmitter | undefined {
    return this.eventEmitter;
  }

  /** Get the structured logger (for external access) */
  getLogger(): StructuredLogger | undefined {
    return this.logger;
  }

  /** Get the debug controller (for external access) */
  getDebugController(): DebugController | undefined {
    return this.debugController;
  }

  /** Capture current execution state for debugging */
  private captureDebugSnapshot(
    action: string,
    stepIndex: number,
    stepType: string,
    pauseReason: DebugPauseReason,
    ctx: ExecutionContext
  ): DebugSnapshot {
    // Collect variables from context chain
    const variables: Record<string, unknown> = {};
    let current: ExecutionContext | undefined = ctx;
    while (current) {
      for (const [key, value] of current.variables) {
        if (!(key in variables)) {
          variables[key] = value;
        }
      }
      current = current.parent;
    }

    // Collect store info
    const stores: Record<string, { type: string; count: number }> = {};
    for (const [name, _store] of ctx.stores) {
      stores[name] = {
        type: ctx.storeTypes.get(name) ?? 'unknown',
        count: -1, // Would need async call to get count
      };
    }

    return {
      mission: this.missionName ?? 'unknown',
      action,
      stepIndex,
      stepType,
      pauseReason,
      variables,
      stores,
      response: ctx.response,
    };
  }

  /** Handle debug command and update state */
  private handleDebugCommand(cmd: DebugCommand): void {
    if (!this.debugController) return;

    switch (cmd.type) {
      case 'abort':
        throw new AbortError('Execution aborted by debugger');
      case 'continue':
        this.debugController.mode = 'run';
        break;
      case 'step':
        this.debugController.mode = 'step';
        break;
      case 'step-into':
        this.debugController.mode = 'step-into';
        break;
      case 'step-over':
        this.debugController.mode = 'step-over';
        break;
    }
  }
}
