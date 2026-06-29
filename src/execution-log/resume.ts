/**
 * Resume helpers: load the current folded state of a run from its log.
 *
 * Resume is "read the log, fold it, continue" — never a second execution. A
 * replaying caller checks {@link FoldedState.appliedEffects} before re-running
 * a side effect, so an effect recorded before a crash is skipped on resume.
 */
import type { ExecutionLogStore } from './store.js';
import { foldLog, type FoldedState } from './fold.js';

/** Read and fold an execution's log into its current state. */
export async function loadState(
  store: ExecutionLogStore,
  executionId: string
): Promise<FoldedState> {
  return foldLog(await store.read(executionId));
}
