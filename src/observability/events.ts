/**
 * Observability Events - Typed events for mission execution
 *
 * Provides a comprehensive event system for tracking execution progress,
 * performance metrics, and debugging information.
 */

/** Log levels for structured logging */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Base event structure for all observability events */
export interface ObservabilityEvent<T = unknown> {
  /** Event type identifier */
  type: string;
  /** Execution context ID */
  executionId: string;
  /** Mission name */
  mission: string;
  /** ISO timestamp */
  timestamp: string;
  /** Duration in milliseconds (for completed events) */
  duration?: number;
  /** Event-specific payload */
  payload: T;
}

// ============================================================================
// Mission Lifecycle Events
// ============================================================================

export interface MissionStartPayload {
  stageCount: number;
  isResume: boolean;
  resumeFromStage?: number;
  metadata?: Record<string, unknown>;
}

export interface MissionCompletePayload {
  success: boolean;
  stagesCompleted: number;
  stagesFailed: number;
  stagesSkipped: number;
  errorCount: number;
}

export interface MissionFailedPayload {
  error: string;
  failedStage?: string;
  stagesCompleted: number;
}

// ============================================================================
// Stage Events
// ============================================================================

export interface StageStartPayload {
  stageIndex: number;
  stageName: string;
  totalStages: number;
  isParallel: boolean;
  parallelActions?: string[];
}

export interface StageCompletePayload {
  stageIndex: number;
  stageName: string;
  success: boolean;
  error?: string;
  itemsProcessed?: number;
}

// ============================================================================
// Step Events
// ============================================================================

export type StepType = 'fetch' | 'for' | 'map' | 'validate' | 'store' | 'match' | 'let' | 'webhook';

export interface StepStartPayload {
  actionName: string;
  stepIndex: number;
  stepType: StepType;
}

export interface StepCompletePayload {
  actionName: string;
  stepIndex: number;
  stepType: StepType;
  success: boolean;
  error?: string;
}

// ============================================================================
// Fetch Events
// ============================================================================

export interface FetchStartPayload {
  source: string;
  method: string;
  path: string;
  isOAS: boolean;
  operationId?: string;
  hasPagination: boolean;
  hasSince: boolean;
}

export interface FetchCompletePayload {
  source: string;
  method: string;
  path: string;
  statusCode: number;
  recordCount: number;
  pagesFetched?: number;
  bytesReceived?: number;
  fromCache?: boolean;
}

export interface FetchRetryPayload {
  source: string;
  path: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
  waitMs: number;
}

export interface FetchErrorPayload {
  source: string;
  path: string;
  statusCode?: number;
  error: string;
  retryable: boolean;
}

// ============================================================================
// Data Flow Events
// ============================================================================

export interface DataTransformPayload {
  targetSchema?: string;
  inputCount: number;
  outputCount: number;
  fieldsMapping: number;
}

export interface DataValidatePayload {
  target: string;
  passed: boolean;
  warningCount: number;
  errorCount: number;
  rules: string[];
}

export interface DataStorePayload {
  storeName: string;
  storeType: string;
  operation: 'set' | 'update' | 'upsert' | 'append';
  itemCount: number;
  key?: string;
}

// ============================================================================
// Loop Events
// ============================================================================

export interface LoopStartPayload {
  variable: string;
  collectionSize: number;
  hasFilter: boolean;
}

export interface LoopIterationPayload {
  variable: string;
  itemIndex: number;
  totalItems: number;
}

export interface LoopCompletePayload {
  variable: string;
  totalItems: number;
  itemsProcessed: number;
  itemsSkipped: number;
  itemsFailed: number;
}

// ============================================================================
// Match Events
// ============================================================================

export interface MatchAttemptPayload {
  schemas: string[];
  hasDefault: boolean;
}

export interface MatchResultPayload {
  matchedSchema?: string;
  isDefault: boolean;
  flowDirective?: 'skip' | 'retry' | 'abort';
}

// ============================================================================
// Webhook Events
// ============================================================================

export interface WebhookRegisterPayload {
  registrationId: string;
  path: string;
  webhookUrl: string;
  timeout: number;
  expectedEvents: number;
}

export interface WebhookEventPayload {
  registrationId: string;
  eventIndex: number;
  totalExpected: number;
  filtered: boolean;
}

export interface WebhookCompletePayload {
  registrationId: string;
  eventsReceived: number;
  timedOut: boolean;
  storedTo?: string;
}

// ============================================================================
// Checkpoint Events
// ============================================================================

export interface CheckpointSavePayload {
  stageIndex: number;
  stepIndex: number;
  reason: 'manual' | 'webhook' | 'error' | 'pause';
  variableCount: number;
}

export interface CheckpointResumePayload {
  stageIndex: number;
  stepIndex: number;
  originalExecutionId: string;
  stagesSkipped: number;
}

// ============================================================================
// Sync Events
// ============================================================================

export interface SyncCheckpointPayload {
  checkpointKey: string;
  lastSyncTime: string;
  recordsFetched: number;
  isIncremental: boolean;
}

// ============================================================================
// Rate Limit / Circuit Breaker Events
// ============================================================================

export interface RateLimitPayload {
  source: string;
  endpoint?: string;
  waitSeconds: number;
  strategy: string;
}

export interface CircuitBreakerPayload {
  source: string;
  endpoint?: string;
  state: 'open' | 'half-open' | 'closed';
  failures: number;
  reason?: string;
}

// ============================================================================
// Event Type Union
// ============================================================================

export type EventType =
  // Mission lifecycle
  | 'mission.start'
  | 'mission.complete'
  | 'mission.failed'
  | 'mission.paused'
  // Stage lifecycle
  | 'stage.start'
  | 'stage.complete'
  // Step lifecycle
  | 'step.start'
  | 'step.complete'
  // Fetch operations
  | 'fetch.start'
  | 'fetch.complete'
  | 'fetch.retry'
  | 'fetch.error'
  // Data operations
  | 'data.transform'
  | 'data.validate'
  | 'data.store'
  // Loop operations
  | 'loop.start'
  | 'loop.iteration'
  | 'loop.complete'
  // Match operations
  | 'match.attempt'
  | 'match.result'
  // Webhook operations
  | 'webhook.register'
  | 'webhook.event'
  | 'webhook.complete'
  // Checkpoints
  | 'checkpoint.save'
  | 'checkpoint.resume'
  // Sync
  | 'sync.checkpoint'
  // Resilience
  | 'ratelimit.wait'
  | 'ratelimit.resume'
  | 'circuit.open'
  | 'circuit.halfopen'
  | 'circuit.close';

// ============================================================================
// Event Emitter Interface
// ============================================================================

export type EventHandler<T = unknown> = (event: ObservabilityEvent<T>) => void;

export interface EventEmitter {
  /** Emit an event */
  emit<T>(type: EventType, payload: T): void;

  /** Subscribe to a specific event type */
  on<T>(type: EventType, handler: EventHandler<T>): () => void;

  /** Subscribe to all events */
  onAll(handler: EventHandler): () => void;

  /** Remove all handlers */
  clear(): void;
}

// ============================================================================
// Event Emitter Implementation
// ============================================================================

export class ObservabilityEmitter implements EventEmitter {
  private executionId: string;
  private mission: string;
  private handlers: Map<EventType, Set<EventHandler>> = new Map();
  private allHandlers: Set<EventHandler> = new Set();
  private startTime: number;
  private lastEventTime: number;

  constructor(executionId: string, mission: string) {
    this.executionId = executionId;
    this.mission = mission;
    this.startTime = Date.now();
    this.lastEventTime = this.startTime;
  }

  emit<T>(type: EventType, payload: T): void {
    const now = Date.now();
    const event: ObservabilityEvent<T> = {
      type,
      executionId: this.executionId,
      mission: this.mission,
      timestamp: new Date().toISOString(),
      duration: now - this.lastEventTime,
      payload,
    };
    this.lastEventTime = now;

    // Notify specific handlers
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch {
          // Swallow handler errors to prevent breaking execution
        }
      }
    }

    // Notify all-event handlers
    for (const handler of this.allHandlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors
      }
    }
  }

  on<T>(type: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler);

    return () => {
      this.handlers.get(type)?.delete(handler as EventHandler);
    };
  }

  onAll(handler: EventHandler): () => void {
    this.allHandlers.add(handler);
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  clear(): void {
    this.handlers.clear();
    this.allHandlers.clear();
  }

  /** Get total elapsed time since emitter creation */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  /** Update execution context (for resume scenarios) */
  setContext(executionId: string, mission: string): void {
    this.executionId = executionId;
    this.mission = mission;
  }
}

/**
 * Create a new observability emitter
 */
export function createEmitter(executionId: string, mission: string): ObservabilityEmitter {
  return new ObservabilityEmitter(executionId, mission);
}
