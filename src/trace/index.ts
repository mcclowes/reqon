/**
 * Trace Module - Time-travel debugging for Reqon
 *
 * Provides execution tracing, replay, and debugging capabilities:
 * - TraceRecorder: Captures execution state at each step
 * - TraceStore: Persists traces for later analysis
 * - TraceReplayer: Navigates and inspects recorded traces
 */

// State types
export type { TraceSnapshot, StoreSnapshot, LoopContext, ExecutionTrace } from './state.js';

export { generateSnapshotId, createExecutionTrace, safeClone, truncateForTrace } from './state.js';

// Store
export type { TraceStore } from './store.js';
export { FileTraceStore, MemoryTraceStore } from './store.js';

// Recorder
export type { TraceRecorderConfig } from './recorder.js';
export { TraceRecorder, createTraceRecorder } from './recorder.js';

// Replay
export type {
  ReplaySession,
  ReplayStepResult,
  TimelineEvent,
  VariableChange,
  SnapshotDiff,
} from './replay.js';
export { TraceReplayer, createTraceReplayer } from './replay.js';

// Log-backed trace view (time-travel as a view over the execution log)
export type { LogTimelineEntry, LogTraceSummary } from './log-view.js';
export { LogTraceView, traceTimelineFromLog } from './log-view.js';
