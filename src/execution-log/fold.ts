/**
 * Fold an execution event log down to current state.
 *
 * This is the heart of replay-based resume: replaying the log and folding it
 * yields the exact state the run was in, including which effects already
 * applied (so replay skips them) and which pause it is waiting on.
 */
import type { StoredEvent } from './events.js';

export type FoldedStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export interface FoldedState {
  status: FoldedStatus;
  /** Sequence of the last event folded (-1 for an empty log). */
  lastSeq: number;
  /** Step ids that have completed (replay skips re-running them). */
  completedSteps: Set<string>;
  /** Effect ids already applied (replay skips re-applying them). */
  appliedEffects: Set<string>;
  /** Latest synced-at per checkpoint key. */
  checkpoints: Map<string, string>;
  /** Resume position per backfill step id (last persisted page + cursor). */
  pageProgress: Map<string, { page: number; cursor?: string; done: boolean }>;
  /** The pause this run is currently waiting on, if any. */
  pendingPauseId?: string;
  /**
   * The last pause marked resumed in the log. A resume trigger (webhook/timeout)
   * can record `pause.resumed` before the executor re-runs, so this lets the
   * executor recognise it must continue past that pause rather than create a new
   * one. Cleared once the run completes or fails.
   */
  resumedPauseId?: string;
  /** Error message if the run failed. */
  error?: string;
}

export function foldLog(events: StoredEvent[]): FoldedState {
  const state: FoldedState = {
    status: 'pending',
    lastSeq: -1,
    completedSteps: new Set(),
    appliedEffects: new Set(),
    checkpoints: new Map(),
    pageProgress: new Map(),
  };

  for (const event of events) {
    state.lastSeq = event.seq;

    switch (event.type) {
      case 'mission.started':
        state.status = 'running';
        break;
      case 'step.completed':
        state.completedSteps.add(event.stepId);
        break;
      case 'effect.applied':
        state.appliedEffects.add(event.effectId);
        break;
      case 'page.completed':
        state.pageProgress.set(event.stepId, {
          page: event.page,
          cursor: event.cursor,
          done: event.done,
        });
        break;
      case 'checkpoint.advanced':
        state.checkpoints.set(event.key, event.syncedAt);
        break;
      case 'pause.created':
        state.status = 'paused';
        state.pendingPauseId = event.pauseId;
        break;
      case 'pause.resumed':
        state.status = 'running';
        state.pendingPauseId = undefined;
        state.resumedPauseId = event.pauseId;
        break;
      case 'mission.completed':
        state.status = 'completed';
        state.resumedPauseId = undefined;
        break;
      case 'mission.failed':
        state.status = 'failed';
        state.error = event.error;
        state.resumedPauseId = undefined;
        break;
      // step.started carries no folded state on its own.
    }
  }

  return state;
}
