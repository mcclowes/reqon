/**
 * Pause State - Types for resource-free long pauses
 *
 * Supports pausing execution for extended periods (days/weeks)
 * while persisting state and releasing resources.
 */

/**
 * Persisted pause state
 */
export interface PauseState {
  /** Unique pause ID */
  id: string;
  /** Execution ID this pause belongs to */
  executionId: string;
  /** Mission name */
  mission: string;
  /** When the pause started */
  pausedAt: Date;
  /** When the pause will expire (resume due to timeout) */
  expiresAt: Date;
  /** Original duration specified (in milliseconds) */
  duration: number;
  /** Current status */
  status: 'waiting' | 'resumed' | 'expired' | 'cancelled';
  /** How the pause was resumed (if resumed) */
  resumedBy?: 'timeout' | 'webhook' | 'manual' | 'cancelled';
  /** When resumed */
  resumedAt?: Date;
  /** Resume trigger configuration */
  resumeTriggers: PauseResumeTriggerState[];
  /** Checkpoint data for resuming execution */
  checkpoint: PauseCheckpoint;
  /** Webhook data if resumed by webhook */
  webhookPayload?: unknown;
}

/**
 * Resume trigger state
 */
export interface PauseResumeTriggerState {
  type: 'timeout' | 'webhook';
  /** For webhook: the registered path */
  path?: string;
  /** For webhook: registration ID */
  registrationId?: string;
  /** Whether this trigger is active */
  active: boolean;
}

/**
 * Checkpoint data for resuming after pause
 */
export interface PauseCheckpoint {
  /** Stage index to resume from */
  stageIndex: number;
  /** Step index within action to resume from (after pause step) */
  stepIndex: number;
  /** Current action name */
  action: string;
  /** For loops: current item index */
  itemIndex?: number;
  /** Saved context variables */
  variables: Record<string, unknown>;
  /** Saved response value */
  response?: unknown;
}

/**
 * Generate a unique pause ID
 */
export function generatePauseId(executionId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `pause_${executionId}_${timestamp}_${random}`;
}

/**
 * Parse duration string to milliseconds
 * Supports: "7d", "1d", "12h", "30m", "45s", or raw milliseconds
 */
export function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration;
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(d|h|m|s|ms)?$/i);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use "7d", "12h", "30m", "45s", or milliseconds.`
    );
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit: ${unit}`);
  }

  return Math.round(value * multiplier);
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
  return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}d`;
}

/**
 * Create initial pause state
 */
export function createPauseState(
  executionId: string,
  mission: string,
  duration: number,
  checkpoint: PauseCheckpoint,
  resumeTriggers: PauseResumeTriggerState[]
): PauseState {
  const now = new Date();

  return {
    id: generatePauseId(executionId),
    executionId,
    mission,
    pausedAt: now,
    expiresAt: new Date(now.getTime() + duration),
    duration,
    status: 'waiting',
    resumeTriggers,
    checkpoint,
  };
}

/**
 * Check if a pause has expired
 */
export function isPauseExpired(pause: PauseState): boolean {
  return pause.status === 'waiting' && new Date() >= pause.expiresAt;
}

/**
 * Get remaining time for a pause (in milliseconds)
 */
export function getRemainingTime(pause: PauseState): number {
  if (pause.status !== 'waiting') return 0;
  const remaining = pause.expiresAt.getTime() - Date.now();
  return Math.max(0, remaining);
}

/**
 * Get pause summary for display
 */
export function getPauseSummary(pause: PauseState): string {
  const remaining = getRemainingTime(pause);

  if (pause.status === 'resumed') {
    return `Pause ${pause.id}: resumed by ${pause.resumedBy} at ${pause.resumedAt?.toISOString()}`;
  }

  if (pause.status === 'expired') {
    return `Pause ${pause.id}: expired at ${pause.expiresAt.toISOString()}`;
  }

  if (pause.status === 'cancelled') {
    return `Pause ${pause.id}: cancelled`;
  }

  return `Pause ${pause.id}: waiting (${formatDuration(remaining)} remaining)`;
}
