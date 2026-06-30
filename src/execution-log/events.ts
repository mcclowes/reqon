/**
 * Execution event log — the durable, append-only record of a mission run.
 *
 * Every step's start, completion, and side effect is appended as it happens.
 * Resume becomes "replay the log and fold to last state" (see {@link ./fold}),
 * and trace/time-travel, audit, and idempotent resume all derive from this one
 * structure. Recorded values (timestamps, effect ids, outputs) are read back on
 * replay rather than re-derived, so replay is deterministic.
 */

export type ExecutionEventType =
  | 'mission.started'
  | 'step.started'
  | 'step.completed'
  | 'effect.applied'
  | 'checkpoint.advanced'
  | 'pause.created'
  | 'pause.resumed'
  | 'mission.completed'
  | 'mission.failed';

interface BaseEvent {
  /** The run this event belongs to. */
  executionId: string;
  /** Event kind (discriminant). */
  type: ExecutionEventType;
}

export interface MissionStartedEvent extends BaseEvent {
  type: 'mission.started';
  mission: string;
}

export interface StepStartedEvent extends BaseEvent {
  type: 'step.started';
  stepId: string;
  action: string;
  stepType: string;
  attempt: number;
}

export interface StepCompletedEvent extends BaseEvent {
  type: 'step.completed';
  stepId: string;
  attempt: number;
}

/**
 * A side effect (a fetch or a store write) was applied. The {@link effectId}
 * is the stable identity used to skip already-applied effects on replay.
 */
export interface EffectAppliedEvent extends BaseEvent {
  type: 'effect.applied';
  stepId: string;
  attempt: number;
  effectType: 'fetch' | 'store';
  effectId: string;
}

export interface CheckpointAdvancedEvent extends BaseEvent {
  type: 'checkpoint.advanced';
  key: string;
  syncedAt: string;
  /** Records fetched in the sync that advanced this checkpoint. */
  recordCount?: number;
  /** Opaque pagination cursor to resume from (cursor-based incremental sync). */
  cursor?: string;
  /** Mission that advanced the checkpoint (lets a shared log filter by mission). */
  mission?: string;
}

export interface PauseCreatedEvent extends BaseEvent {
  type: 'pause.created';
  pauseId: string;
}

export interface PauseResumedEvent extends BaseEvent {
  type: 'pause.resumed';
  pauseId: string;
  resumedBy: string;
}

export interface MissionCompletedEvent extends BaseEvent {
  type: 'mission.completed';
}

export interface MissionFailedEvent extends BaseEvent {
  type: 'mission.failed';
  error: string;
}

/** An event as appended by a caller (the log assigns seq + timestamp). */
export type ExecutionEvent =
  | MissionStartedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | EffectAppliedEvent
  | CheckpointAdvancedEvent
  | PauseCreatedEvent
  | PauseResumedEvent
  | MissionCompletedEvent
  | MissionFailedEvent;

/** A persisted event: the appended event plus the log's assigned metadata. */
export type StoredEvent = ExecutionEvent & {
  /** Monotonic sequence within the execution, starting at 0. */
  seq: number;
  /** Recorded wall-clock time (ISO 8601); read back on replay, never re-derived. */
  at: string;
};

/**
 * Stable identity for a side effect: `(executionId, stepId, attempt, effectType)`
 * plus a caller-supplied discriminator (e.g. the request signature or record
 * key). Replay uses this to skip effects already recorded as applied.
 */
export function effectId(
  executionId: string,
  stepId: string,
  attempt: number,
  effectType: 'fetch' | 'store',
  discriminator: string
): string {
  return `${executionId}::${stepId}::${attempt}::${effectType}::${discriminator}`;
}
