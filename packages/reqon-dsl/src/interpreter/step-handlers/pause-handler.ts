/**
 * Pause Step Handler - Handles resource-free long pauses
 *
 * Creates a durable pause that persists state and releases resources,
 * allowing execution to be resumed after extended periods.
 */

import type { PauseStep } from '../../ast/nodes.js';
import type { ExecutionContext } from '../context.js';
import type { EventType } from '../../observability/index.js';
import type { PauseManager, PauseCheckpoint } from '../../pause/index.js';
import { parseDuration, formatDuration } from '../../pause/state.js';
import { PauseSignal } from '../signals.js';

/**
 * Dependencies for pause handler
 */
export interface PauseHandlerDeps {
  ctx: ExecutionContext;
  log: (message: string) => void;
  emit?: <T>(type: EventType, payload: T) => void;
  /** Pause manager for creating and persisting pauses */
  pauseManager: PauseManager;
  /** Execution ID */
  executionId: string;
  /** Mission name */
  mission: string;
  /** Current action name */
  actionName: string;
  /** Current stage index */
  stageIndex: number;
  /** Current step index */
  stepIndex: number;
  /** For loop context (if inside a loop) */
  loopItemIndex?: number;
}

/**
 * Result of pause execution
 */
export interface PauseHandlerResult {
  /** The pause ID */
  pauseId: string;
  /** Duration in milliseconds */
  duration: number;
  /** When the pause expires */
  expiresAt: Date;
}

/**
 * Handles pause step execution
 */
export class PauseHandler {
  private deps: PauseHandlerDeps;

  constructor(deps: PauseHandlerDeps) {
    this.deps = deps;
  }

  async execute(step: PauseStep): Promise<PauseHandlerResult> {
    const duration = parseDuration(step.duration);

    this.deps.log(`Starting pause for ${formatDuration(duration)}`);

    // Capture current context variables
    const variables = this.captureVariables();

    // Build checkpoint
    const checkpoint: PauseCheckpoint = {
      stageIndex: this.deps.stageIndex,
      stepIndex: this.deps.stepIndex + 1, // Resume AFTER this pause step
      action: this.deps.actionName,
      itemIndex: this.deps.loopItemIndex,
      variables,
      response: this.deps.ctx.response,
    };

    // Build resume triggers
    const resumeTriggers: Array<{ type: 'timeout' } | { type: 'webhook'; path: string }> = [];

    if (step.resumeOn && step.resumeOn.length > 0) {
      for (const trigger of step.resumeOn) {
        if (trigger.type === 'timeout') {
          resumeTriggers.push({ type: 'timeout' });
        } else if (trigger.type === 'webhook') {
          resumeTriggers.push({ type: 'webhook', path: trigger.path });
        }
      }
    } else {
      // Default to timeout only
      resumeTriggers.push({ type: 'timeout' });
    }

    // Create the pause via pause manager
    const pause = await this.deps.pauseManager.createPause({
      executionId: this.deps.executionId,
      mission: this.deps.mission,
      duration,
      checkpoint,
      resumeTriggers,
    });

    // Emit pause event
    this.deps.emit?.('mission.paused', {
      pauseId: pause.id,
      duration,
      expiresAt: pause.expiresAt,
      resumeTriggers: resumeTriggers.map((t) => t.type),
    });

    this.deps.log(`Pause ${pause.id} created - will expire at ${pause.expiresAt.toISOString()}`);

    // Throw PauseSignal to stop execution
    // The executor will catch this and handle appropriately
    throw new PauseSignal(pause.id);
  }

  private captureVariables(): Record<string, unknown> {
    const variables: Record<string, unknown> = {};
    let current: ExecutionContext | undefined = this.deps.ctx;

    while (current) {
      for (const [key, value] of current.variables) {
        if (!(key in variables)) {
          // Deep clone to ensure we capture the current state
          try {
            variables[key] = JSON.parse(JSON.stringify(value));
          } catch {
            // If value can't be serialized, skip it
            variables[key] = '[non-serializable]';
          }
        }
      }
      current = current.parent;
    }

    return variables;
  }
}
