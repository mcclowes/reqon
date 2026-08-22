/**
 * Trace as a view over the execution log.
 *
 * Time-travel debugging and the audit trail fall straight out of the
 * append-only log: the ordered sequence of events *is* the trace. This module
 * derives a navigable timeline and a folded summary from `StoredEvent[]`, so a
 * run's history is reconstructable from the log with no separate trace store.
 *
 * Scope: the log records the structural timeline (steps, effects, checkpoints,
 * pauses, errors), which is what time-travel navigation and audit need. The
 * richer variable-level snapshots remain the job of the opt-in {@link TraceRecorder}.
 */
import type { ExecutionLogStore, StoredEvent, ExecutionEventType } from '../execution-log/index.js';
import { foldLog } from '../execution-log/index.js';

/** One step in the timeline view, derived from a single log event. */
export interface LogTimelineEntry {
  /** Sequence within the execution (the time-travel cursor). */
  seq: number;
  /** Recorded wall-clock time (ISO 8601). */
  at: string;
  /** The underlying event type. */
  type: ExecutionEventType;
  /** Action name, for step events. */
  action?: string;
  /** Step identity, for step/effect events. */
  step?: string;
  /** Step kind (fetch, store, …), for step events. */
  stepType?: string;
  /** Attempt number, for step/effect events. */
  attempt?: number;
  /** Human-readable summary of this entry. */
  detail?: string;
}

/** A folded summary of a run, for the trace overview. */
export interface LogTraceSummary {
  status: ReturnType<typeof foldLog>['status'];
  totalEvents: number;
  stepsCompleted: number;
  effectsApplied: number;
  checkpoints: number;
  pendingPauseId?: string;
  error?: string;
}

function describe(event: StoredEvent): string | undefined {
  switch (event.type) {
    case 'mission.started':
      return `mission ${event.mission} started`;
    case 'step.started':
      return `${event.action}: ${event.stepType} step started`;
    case 'step.completed':
      return `step ${event.stepId} completed`;
    case 'effect.applied':
      return `${event.effectType} effect applied`;
    case 'checkpoint.advanced':
      return `checkpoint ${event.key} -> ${event.syncedAt}`;
    case 'pause.created':
      return `paused (${event.pauseId})`;
    case 'pause.resumed':
      return `resumed by ${event.resumedBy}`;
    case 'mission.completed':
      return 'mission completed';
    case 'mission.failed':
      return `mission failed: ${event.error}`;
    default:
      return undefined;
  }
}

/** Build an ordered, navigable timeline from a run's log events. */
export function traceTimelineFromLog(events: StoredEvent[]): LogTimelineEntry[] {
  return events.map((event) => {
    const entry: LogTimelineEntry = {
      seq: event.seq,
      at: event.at,
      type: event.type,
      detail: describe(event),
    };
    if ('action' in event) entry.action = event.action;
    if ('stepId' in event) entry.step = event.stepId;
    if ('stepType' in event) entry.stepType = event.stepType;
    if ('attempt' in event) entry.attempt = event.attempt;
    return entry;
  });
}

/**
 * Navigable, log-backed trace for one execution: the timeline and a folded
 * summary, read straight from the execution log.
 */
export class LogTraceView {
  constructor(
    private log: ExecutionLogStore,
    private executionId: string
  ) {}

  async events(): Promise<StoredEvent[]> {
    return this.log.read(this.executionId);
  }

  async timeline(): Promise<LogTimelineEntry[]> {
    return traceTimelineFromLog(await this.events());
  }

  async summary(): Promise<LogTraceSummary> {
    const events = await this.events();
    const folded = foldLog(events);
    return {
      status: folded.status,
      totalEvents: events.length,
      stepsCompleted: folded.completedSteps.size,
      effectsApplied: folded.appliedEffects.size,
      checkpoints: folded.checkpoints.size,
      pendingPauseId: folded.pendingPauseId,
      error: folded.error,
    };
  }
}
