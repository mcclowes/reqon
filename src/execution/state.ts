/**
 * Execution State - Durable state for resumable missions
 *
 * Tracks progress through pipeline stages, enabling:
 * - Resume from last successful step after failures
 * - Idempotent re-execution
 * - Progress visibility
 */

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * State for a single pipeline stage (action execution)
 */
export interface StageState {
  /** Action name */
  action: string;
  /** Current status */
  status: StageStatus;
  /** When this stage started */
  startedAt?: Date;
  /** When this stage completed/failed */
  completedAt?: Date;
  /** Error message if failed */
  error?: string;
  /** Number of items processed (for actions with loops) */
  itemsProcessed?: number;
  /** Total items to process */
  itemsTotal?: number;
  /** Retry attempt number (0 = first attempt) */
  attempt: number;
}

/**
 * Checkpoint within an action (for resuming mid-action)
 */
export interface Checkpoint {
  /** Stage index in pipeline */
  stageIndex: number;
  /** Step index within action */
  stepIndex: number;
  /** For loops: current item index */
  itemIndex?: number;
  /** Saved context variables */
  variables?: Record<string, unknown>;
  /** Timestamp */
  createdAt: Date;
  /** Webhook wait state (for resuming webhook waits) */
  webhookWait?: WebhookWaitState;
}

/**
 * State for waiting on webhook callbacks
 */
export interface WebhookWaitState {
  /** Webhook registration ID */
  registrationId: string;
  /** Path for the webhook endpoint */
  path: string;
  /** Full webhook URL */
  webhookUrl: string;
  /** Number of expected events */
  expectedEvents: number;
  /** Number of events received so far */
  receivedEvents: number;
  /** When the wait started */
  waitStartedAt: Date;
  /** When the wait expires */
  expiresAt: Date;
}

/**
 * Complete execution state for a mission run
 */
export interface ExecutionState {
  /** Unique execution ID */
  id: string;
  /** Mission name */
  mission: string;
  /** Overall status */
  status: ExecutionStatus;
  /** When execution started */
  startedAt: Date;
  /** When execution completed/failed */
  completedAt?: Date;
  /** Total duration in ms */
  duration?: number;
  /** State of each pipeline stage */
  stages: StageState[];
  /** Latest checkpoint for resume */
  checkpoint?: Checkpoint;
  /** Execution errors */
  errors: ExecutionStateError[];
  /** Metadata (user-provided context) */
  metadata?: Record<string, unknown>;
}

export interface ExecutionStateError {
  stageIndex: number;
  action: string;
  step: string;
  message: string;
  timestamp: Date;
  attempt: number;
}

/**
 * Options for creating a new execution
 */
export interface CreateExecutionOptions {
  /** Mission name */
  mission: string;
  /** Pipeline stage names (actions) */
  stages: string[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Generate a unique execution ID
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `exec_${timestamp}_${random}`;
}

/**
 * Create initial execution state
 */
export function createExecutionState(options: CreateExecutionOptions): ExecutionState {
  return {
    id: generateExecutionId(),
    mission: options.mission,
    status: 'pending',
    startedAt: new Date(),
    stages: options.stages.map((action) => ({
      action,
      status: 'pending',
      attempt: 0,
    })),
    errors: [],
    metadata: options.metadata,
  };
}

/**
 * Find the stage to resume from
 * Returns the index of the first non-completed stage, or -1 if all complete
 */
export function findResumePoint(state: ExecutionState): number {
  // If there's a checkpoint, use it
  if (state.checkpoint) {
    return state.checkpoint.stageIndex;
  }

  // Otherwise, find first non-completed stage
  for (let i = 0; i < state.stages.length; i++) {
    const stage = state.stages[i];
    if (stage.status !== 'completed' && stage.status !== 'skipped') {
      return i;
    }
  }

  return -1; // All stages complete
}

/**
 * Check if execution can be resumed
 */
export function canResume(state: ExecutionState): boolean {
  return state.status === 'failed' || state.status === 'paused';
}

/**
 * Calculate execution progress as percentage
 */
export function getProgress(state: ExecutionState): number {
  if (state.stages.length === 0) return 100;

  const completed = state.stages.filter(
    (s) => s.status === 'completed' || s.status === 'skipped'
  ).length;

  return Math.round((completed / state.stages.length) * 100);
}

/**
 * Get a summary of the execution state
 */
export function getExecutionSummary(state: ExecutionState): string {
  const progress = getProgress(state);
  const completed = state.stages.filter((s) => s.status === 'completed').length;
  const failed = state.stages.filter((s) => s.status === 'failed').length;
  const pending = state.stages.filter((s) => s.status === 'pending').length;

  let summary = `${state.mission} [${state.id}]: ${state.status} (${progress}%)`;
  summary += ` - ${completed} completed, ${failed} failed, ${pending} pending`;

  if (state.duration) {
    summary += ` - ${Math.round(state.duration / 1000)}s`;
  }

  return summary;
}
