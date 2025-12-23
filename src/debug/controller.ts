/**
 * Debug Controller - Types and interface for step-through debugging
 *
 * Provides a programmatic API for debugging Reqon missions.
 * Can be used by CLI debugger or external tools (VS Code, web UI).
 */

/** Execution mode for the debugger */
export type DebugMode = 'run' | 'step' | 'step-into' | 'step-over';

/** Reason why execution paused */
export type DebugPauseReason =
  | { type: 'step' }
  | { type: 'loop-iteration'; variable: string; index: number; total: number }
  | { type: 'match-arm'; schema: string }
  | { type: 'breakpoint'; location: string };

/** Snapshot of execution state at a pause point */
export interface DebugSnapshot {
  mission: string;
  action: string;
  stepIndex: number;
  stepType: string;
  pauseReason: DebugPauseReason;
  variables: Record<string, unknown>;
  stores: Record<string, { type: string; count: number }>;
  response: unknown;
}

/** Command from debugger to control execution */
export type DebugCommand =
  | { type: 'continue' }
  | { type: 'step' }
  | { type: 'step-into' }
  | { type: 'step-over' }
  | { type: 'abort' };

/** Location in execution for pause/breakpoint checking */
export interface DebugLocation {
  action: string;
  stepIndex: number;
  stepType: string;
  isLoopIteration?: boolean;
  isMatchArm?: boolean;
  loopInfo?: { variable: string; index: number; total: number };
  matchInfo?: { schema: string };
}

/** Debug controller interface for step-through execution */
export interface DebugController {
  /** Current execution mode */
  mode: DebugMode;

  /** Active breakpoints (format: "ActionName:stepIndex" or "ActionName:*") */
  breakpoints: Set<string>;

  /** Check if we should pause at this location */
  shouldPause(location: DebugLocation): boolean;

  /** Pause execution and wait for user command */
  pause(snapshot: DebugSnapshot): Promise<DebugCommand>;

  /** Add a breakpoint */
  addBreakpoint(location: string): void;

  /** Remove a breakpoint */
  removeBreakpoint(location: string): void;

  /** Cleanup resources (e.g., close readline) */
  close?(): void;
}

/**
 * Base debug controller with common logic.
 * Extend this class to create custom debuggers.
 */
export abstract class BaseDebugController implements DebugController {
  mode: DebugMode = 'step';
  breakpoints = new Set<string>();

  shouldPause(location: DebugLocation): boolean {
    // Always pause at breakpoints
    const exactMatch = `${location.action}:${location.stepIndex}`;
    const wildcardMatch = `${location.action}:*`;
    if (this.breakpoints.has(exactMatch) || this.breakpoints.has(wildcardMatch)) {
      return true;
    }

    // In 'run' mode, only pause at breakpoints
    if (this.mode === 'run') {
      return false;
    }

    // In 'step' mode, pause at every step (but not loop iterations or match arms)
    if (this.mode === 'step') {
      return !location.isLoopIteration && !location.isMatchArm;
    }

    // In 'step-into' mode, pause at everything including loop iterations and match arms
    if (this.mode === 'step-into') {
      return true;
    }

    // In 'step-over' mode, pause at steps but skip loop iterations and match arms
    if (this.mode === 'step-over') {
      return !location.isLoopIteration && !location.isMatchArm;
    }

    return false;
  }

  abstract pause(snapshot: DebugSnapshot): Promise<DebugCommand>;

  addBreakpoint(location: string): void {
    this.breakpoints.add(location);
  }

  removeBreakpoint(location: string): void {
    this.breakpoints.delete(location);
  }
}
