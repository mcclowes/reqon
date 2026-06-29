/**
 * Execution event log — the append-only foundation for durable execution.
 *
 * A running mission is modelled as an ordered log of events; resume is replay +
 * fold (see {@link foldLog}), and idempotent effects fall out of recording an
 * `effect.applied` event per side effect. This module is the seam the rest of
 * the durable-execution work (transactional backend, exactly-once effects,
 * trace/sync/pause as log views) builds on.
 */
export type {
  ExecutionEvent,
  StoredEvent,
  ExecutionEventType,
  MissionStartedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  EffectAppliedEvent,
  CheckpointAdvancedEvent,
  PauseCreatedEvent,
  PauseResumedEvent,
  MissionCompletedEvent,
  MissionFailedEvent,
} from './events.js';
export { effectId } from './events.js';

export type { ExecutionLogStore } from './store.js';
export { MemoryExecutionLog, FileExecutionLog } from './store.js';
export { SqliteExecutionLog } from './sqlite-store.js';
export { PostgresExecutionLog, type PostgresExecutionLogOptions } from './postgres-store.js';

export type { FoldedState, FoldedStatus } from './fold.js';
export { foldLog } from './fold.js';

export { loadState } from './resume.js';
