/**
 * Trace Replay - Time-travel debugging for execution traces
 *
 * Allows stepping through recorded execution traces,
 * inspecting state at each point, and comparing across runs.
 */

import type { TraceStore } from './store.js';
import type { ExecutionTrace, TraceSnapshot, LoopContext } from './state.js';

/**
 * Replay session state
 */
export interface ReplaySession {
  /** Trace being replayed */
  trace: ExecutionTrace;
  /** Current snapshot index */
  currentIndex: number;
  /** Total snapshots */
  totalSnapshots: number;
  /** Current snapshot */
  currentSnapshot: TraceSnapshot | null;
  /** Replay mode */
  mode: 'paused' | 'stepping' | 'running';
}

/**
 * Replay step result
 */
export interface ReplayStepResult {
  /** The snapshot at this step */
  snapshot: TraceSnapshot;
  /** Whether there are more steps */
  hasNext: boolean;
  /** Whether there are previous steps */
  hasPrevious: boolean;
  /** Human-readable summary of this step */
  summary: string;
}

/**
 * Replay controller for navigating execution traces
 */
export class TraceReplayer {
  private store: TraceStore;
  private session: ReplaySession | null = null;

  constructor(store: TraceStore) {
    this.store = store;
  }

  /**
   * Load a trace and start a replay session
   */
  async loadTrace(traceId: string): Promise<ReplaySession> {
    const trace = await this.store.load(traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${traceId}`);
    }

    this.session = {
      trace,
      currentIndex: 0,
      totalSnapshots: trace.snapshots.length,
      currentSnapshot: trace.snapshots[0] ?? null,
      mode: 'paused',
    };

    return this.session;
  }

  /**
   * Load the latest trace for a mission
   */
  async loadLatest(mission: string): Promise<ReplaySession> {
    const trace = await this.store.findLatest(mission);
    if (!trace) {
      throw new Error(`No traces found for mission: ${mission}`);
    }

    // Load full trace with snapshots
    const fullTrace = await this.store.load(trace.id);
    if (!fullTrace) {
      throw new Error(`Failed to load trace: ${trace.id}`);
    }

    this.session = {
      trace: fullTrace,
      currentIndex: 0,
      totalSnapshots: fullTrace.snapshots.length,
      currentSnapshot: fullTrace.snapshots[0] ?? null,
      mode: 'paused',
    };

    return this.session;
  }

  /**
   * Get current session state
   */
  getSession(): ReplaySession | null {
    return this.session;
  }

  /**
   * Go to a specific step by index
   */
  async goToStep(index: number): Promise<ReplayStepResult> {
    if (!this.session) {
      throw new Error('No replay session active');
    }

    if (index < 0 || index >= this.session.totalSnapshots) {
      throw new Error(
        `Invalid step index: ${index}. Valid range: 0-${this.session.totalSnapshots - 1}`
      );
    }

    this.session.currentIndex = index;
    this.session.currentSnapshot = this.session.trace.snapshots[index];

    return this.formatStepResult(this.session.currentSnapshot);
  }

  /**
   * Go to the next step
   */
  async next(): Promise<ReplayStepResult | null> {
    if (!this.session) {
      throw new Error('No replay session active');
    }

    if (this.session.currentIndex >= this.session.totalSnapshots - 1) {
      return null;
    }

    return this.goToStep(this.session.currentIndex + 1);
  }

  /**
   * Go to the previous step
   */
  async previous(): Promise<ReplayStepResult | null> {
    if (!this.session) {
      throw new Error('No replay session active');
    }

    if (this.session.currentIndex <= 0) {
      return null;
    }

    return this.goToStep(this.session.currentIndex - 1);
  }

  /**
   * Jump to the first step of an action
   */
  async goToAction(actionName: string): Promise<ReplayStepResult | null> {
    if (!this.session) {
      throw new Error('No replay session active');
    }

    const index = this.session.trace.snapshots.findIndex(
      (s) => s.action === actionName && s.phase === 'before'
    );

    if (index === -1) {
      return null;
    }

    return this.goToStep(index);
  }

  /**
   * Jump to a step where a specific variable changed
   */
  async findVariableChange(variableName: string, fromIndex = 0): Promise<ReplayStepResult | null> {
    if (!this.session) {
      throw new Error('No replay session active');
    }

    let previousValue: unknown = undefined;

    for (let i = fromIndex; i < this.session.totalSnapshots; i++) {
      const snapshot = this.session.trace.snapshots[i];
      const currentValue = snapshot.variables[variableName];

      if (i === fromIndex) {
        previousValue = currentValue;
        continue;
      }

      if (JSON.stringify(currentValue) !== JSON.stringify(previousValue)) {
        return this.goToStep(i);
      }

      previousValue = currentValue;
    }

    return null;
  }

  /**
   * Find steps where an error occurred
   */
  findErrors(): number[] {
    if (!this.session) {
      return [];
    }

    return this.session.trace.snapshots.map((s, i) => (s.error ? i : -1)).filter((i) => i !== -1);
  }

  /**
   * Get all unique action names in the trace
   */
  getActions(): string[] {
    if (!this.session) {
      return [];
    }

    const actions = new Set<string>();
    for (const snapshot of this.session.trace.snapshots) {
      actions.add(snapshot.action);
    }
    return Array.from(actions);
  }

  /**
   * Get execution timeline with key events
   */
  getTimeline(): TimelineEvent[] {
    if (!this.session) {
      return [];
    }

    const events: TimelineEvent[] = [];
    let currentAction = '';

    for (const snapshot of this.session.trace.snapshots) {
      if (snapshot.action !== currentAction && snapshot.phase === 'before') {
        events.push({
          type: 'action-start',
          index: snapshot.index,
          action: snapshot.action,
          timestamp: snapshot.timestamp,
        });
        currentAction = snapshot.action;
      }

      if (snapshot.error) {
        events.push({
          type: 'error',
          index: snapshot.index,
          action: snapshot.action,
          step: snapshot.stepType,
          message: snapshot.error,
          timestamp: snapshot.timestamp,
        });
      }

      if (snapshot.loopContext && snapshot.phase === 'before') {
        events.push({
          type: 'loop-iteration',
          index: snapshot.index,
          action: snapshot.action,
          loopContext: snapshot.loopContext,
          timestamp: snapshot.timestamp,
        });
      }
    }

    return events;
  }

  /**
   * Compare two snapshots
   */
  compareSnapshots(index1: number, index2: number): SnapshotDiff {
    if (!this.session) {
      throw new Error('No replay session active');
    }

    const snap1 = this.session.trace.snapshots[index1];
    const snap2 = this.session.trace.snapshots[index2];

    if (!snap1 || !snap2) {
      throw new Error('Invalid snapshot indices');
    }

    const variableChanges: VariableChange[] = [];

    // Find variables that changed
    const allVars = new Set([...Object.keys(snap1.variables), ...Object.keys(snap2.variables)]);

    for (const varName of allVars) {
      const val1 = snap1.variables[varName];
      const val2 = snap2.variables[varName];

      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        variableChanges.push({
          name: varName,
          before: val1,
          after: val2,
          type: val1 === undefined ? 'added' : val2 === undefined ? 'removed' : 'changed',
        });
      }
    }

    return {
      snapshot1: snap1,
      snapshot2: snap2,
      variableChanges,
      responseDifferent: JSON.stringify(snap1.response) !== JSON.stringify(snap2.response),
      stepsExecuted: index2 - index1,
    };
  }

  /**
   * Export trace to JSON for external analysis
   */
  exportTrace(): ExecutionTrace | null {
    return this.session?.trace ?? null;
  }

  private formatStepResult(snapshot: TraceSnapshot): ReplayStepResult {
    const hasNext = this.session!.currentIndex < this.session!.totalSnapshots - 1;
    const hasPrevious = this.session!.currentIndex > 0;

    let summary = `[${snapshot.index}] ${snapshot.phase.toUpperCase()} ${snapshot.action}.${snapshot.stepType}`;

    if (snapshot.loopContext) {
      summary += ` (loop ${snapshot.loopContext.itemIndex + 1}/${snapshot.loopContext.totalItems})`;
    }

    if (snapshot.stepDuration !== undefined) {
      summary += ` - ${snapshot.stepDuration}ms`;
    }

    if (snapshot.error) {
      summary += ` - ERROR: ${snapshot.error}`;
    }

    return {
      snapshot,
      hasNext,
      hasPrevious,
      summary,
    };
  }
}

/**
 * Timeline event types
 */
export interface TimelineEvent {
  type: 'action-start' | 'error' | 'loop-iteration' | 'checkpoint';
  index: number;
  action: string;
  step?: string;
  message?: string;
  loopContext?: LoopContext;
  timestamp: Date;
}

/**
 * Variable change in diff
 */
export interface VariableChange {
  name: string;
  before: unknown;
  after: unknown;
  type: 'added' | 'removed' | 'changed';
}

/**
 * Snapshot comparison result
 */
export interface SnapshotDiff {
  snapshot1: TraceSnapshot;
  snapshot2: TraceSnapshot;
  variableChanges: VariableChange[];
  responseDifferent: boolean;
  stepsExecuted: number;
}

/**
 * Create a trace replayer
 */
export function createTraceReplayer(store: TraceStore): TraceReplayer {
  return new TraceReplayer(store);
}
