/**
 * Pause Manager - Orchestrates resource-free long pauses
 *
 * Handles pause creation, monitoring, and resume coordination.
 * Integrates with webhook server for webhook-based resume triggers.
 */

import type { PauseStore } from './store.js';
import type { WebhookServer } from '../webhook/index.js';
import {
  type PauseState,
  type PauseCheckpoint,
  type PauseResumeTriggerState,
  createPauseState,
  parseDuration,
  isPauseExpired,
  getRemainingTime,
  formatDuration,
} from './state.js';

export interface PauseManagerConfig {
  /** Store for persisting pause states */
  store: PauseStore;
  /** Webhook server for webhook-based resume (optional) */
  webhookServer?: WebhookServer;
  /** Polling interval for checking expired pauses (ms) */
  pollInterval?: number;
  /** Callback when a pause is resumed */
  onResume?: (pause: PauseState) => void | Promise<void>;
  /** Logger function */
  log?: (message: string) => void;
}

/**
 * Options for creating a pause
 */
export interface CreatePauseOptions {
  /** Execution ID */
  executionId: string;
  /** Mission name */
  mission: string;
  /** Duration (e.g., "7d", "12h", or milliseconds) */
  duration: string | number;
  /** Checkpoint data for resuming */
  checkpoint: PauseCheckpoint;
  /** Resume triggers */
  resumeTriggers?: Array<{ type: 'timeout' } | { type: 'webhook'; path: string }>;
}

/**
 * Manages resource-free long pauses
 */
export class PauseManager {
  private config: PauseManagerConfig;
  private pollTimer?: ReturnType<typeof setInterval>;
  private isRunning = false;

  constructor(config: PauseManagerConfig) {
    this.config = config;
  }

  /**
   * Create a new pause and persist state
   */
  async createPause(options: CreatePauseOptions): Promise<PauseState> {
    const duration = parseDuration(options.duration);

    // Build resume trigger states
    const resumeTriggers: PauseResumeTriggerState[] = [];

    // Always include timeout by default
    const triggers = options.resumeTriggers ?? [{ type: 'timeout' }];
    const hasTimeout = triggers.some((t) => t.type === 'timeout');
    if (!hasTimeout) {
      triggers.push({ type: 'timeout' });
    }

    for (const trigger of triggers) {
      if (trigger.type === 'timeout') {
        resumeTriggers.push({ type: 'timeout', active: true });
      } else if (trigger.type === 'webhook') {
        const triggerState: PauseResumeTriggerState = {
          type: 'webhook',
          path: trigger.path,
          active: true,
        };

        // Register webhook if server available
        if (this.config.webhookServer) {
          const registration = await this.registerWebhookTrigger(
            options.executionId,
            trigger.path,
            duration
          );
          triggerState.registrationId = registration.id;
        }

        resumeTriggers.push(triggerState);
      }
    }

    // Create pause state
    const pause = createPauseState(
      options.executionId,
      options.mission,
      duration,
      options.checkpoint,
      resumeTriggers
    );

    // Persist
    await this.config.store.save(pause);

    this.log(`Created pause ${pause.id} for ${formatDuration(duration)}`);

    return pause;
  }

  /**
   * Resume a pause manually
   */
  async resumeManually(pauseId: string): Promise<PauseState> {
    const pause = await this.config.store.load(pauseId);
    if (!pause) {
      throw new Error(`Pause not found: ${pauseId}`);
    }

    if (pause.status !== 'waiting') {
      throw new Error(`Pause ${pauseId} is not waiting (status: ${pause.status})`);
    }

    return this.markResumed(pause, 'manual');
  }

  /**
   * Resume a pause by execution ID
   */
  async resumeByExecution(executionId: string): Promise<PauseState | null> {
    const pause = await this.config.store.loadByExecution(executionId);
    if (!pause) {
      return null;
    }

    return this.resumeManually(pause.id);
  }

  /**
   * Cancel a pause (without resuming execution)
   */
  async cancelPause(pauseId: string): Promise<void> {
    const pause = await this.config.store.load(pauseId);
    if (!pause) {
      throw new Error(`Pause not found: ${pauseId}`);
    }

    if (pause.status !== 'waiting') {
      return; // Already not waiting
    }

    await this.config.store.update(pauseId, {
      status: 'cancelled',
      resumedAt: new Date(),
      resumedBy: 'cancelled',
    });

    // Cleanup webhook registrations
    await this.cleanupWebhooks(pause);

    this.log(`Cancelled pause ${pauseId}`);
  }

  /**
   * Handle webhook callback for a pause
   */
  async handleWebhook(pauseId: string, payload: unknown): Promise<boolean> {
    const pause = await this.config.store.load(pauseId);
    if (!pause || pause.status !== 'waiting') {
      return false;
    }

    // Check if this pause has an active webhook trigger
    const webhookTrigger = pause.resumeTriggers.find((t) => t.type === 'webhook' && t.active);

    if (!webhookTrigger) {
      return false;
    }

    // Mark resumed with webhook payload
    await this.markResumed(pause, 'webhook', payload);

    return true;
  }

  /**
   * Start monitoring for expired pauses
   */
  startMonitoring(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    const interval = this.config.pollInterval ?? 60000; // Default: 1 minute

    this.pollTimer = setInterval(async () => {
      await this.checkExpiredPauses();
    }, interval);

    this.log(`Started pause monitoring (interval: ${formatDuration(interval)})`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.isRunning = false;
    this.log('Stopped pause monitoring');
  }

  /**
   * Check for and process expired pauses
   */
  async checkExpiredPauses(): Promise<PauseState[]> {
    const expired = await this.config.store.findExpired();
    const resumed: PauseState[] = [];

    for (const pause of expired) {
      const updated = await this.markResumed(pause, 'timeout');
      resumed.push(updated);
    }

    return resumed;
  }

  /**
   * Get all active pauses
   */
  async getActivePauses(): Promise<PauseState[]> {
    return this.config.store.listActive();
  }

  /**
   * Get pause by ID
   */
  async getPause(pauseId: string): Promise<PauseState | null> {
    return this.config.store.load(pauseId);
  }

  /**
   * Get pause status summary
   */
  async getStatus(): Promise<PauseStatus> {
    const active = await this.config.store.listActive();
    const expired = active.filter((p) => isPauseExpired(p));
    const waiting = active.filter((p) => !isPauseExpired(p));

    return {
      totalActive: active.length,
      waiting: waiting.length,
      expired: expired.length,
      nextExpiration:
        waiting.length > 0
          ? waiting.reduce(
              (min, p) => (p.expiresAt < min ? p.expiresAt : min),
              waiting[0].expiresAt
            )
          : undefined,
      pauses: active.map((p) => ({
        id: p.id,
        mission: p.mission,
        executionId: p.executionId,
        remaining: getRemainingTime(p),
        remainingFormatted: formatDuration(getRemainingTime(p)),
      })),
    };
  }

  private async markResumed(
    pause: PauseState,
    resumedBy: 'timeout' | 'webhook' | 'manual',
    webhookPayload?: unknown
  ): Promise<PauseState> {
    const updates: Partial<PauseState> = {
      status: 'resumed',
      resumedAt: new Date(),
      resumedBy,
    };

    if (webhookPayload !== undefined) {
      updates.webhookPayload = webhookPayload;
    }

    await this.config.store.update(pause.id, updates);

    // Cleanup webhook registrations
    await this.cleanupWebhooks(pause);

    const updated = await this.config.store.load(pause.id);
    if (!updated) {
      throw new Error(`Failed to load updated pause: ${pause.id}`);
    }

    this.log(`Pause ${pause.id} resumed by ${resumedBy}`);

    // Trigger callback
    if (this.config.onResume) {
      await this.config.onResume(updated);
    }

    return updated;
  }

  private async registerWebhookTrigger(
    executionId: string,
    path: string,
    timeout: number
  ): Promise<{ id: string }> {
    if (!this.config.webhookServer) {
      throw new Error('Webhook server not configured for webhook triggers');
    }

    // Register a webhook listener that will call handleWebhook
    const registration = await this.config.webhookServer.register(executionId, {
      path,
      timeout,
      expectedEvents: 1,
    });

    return { id: registration.id };
  }

  private async cleanupWebhooks(pause: PauseState): Promise<void> {
    if (!this.config.webhookServer) return;

    for (const trigger of pause.resumeTriggers) {
      if (trigger.type === 'webhook' && trigger.registrationId) {
        try {
          await this.config.webhookServer.unregister(trigger.registrationId);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private log(message: string): void {
    this.config.log?.(`[PauseManager] ${message}`);
  }
}

/**
 * Pause status summary
 */
export interface PauseStatus {
  totalActive: number;
  waiting: number;
  expired: number;
  nextExpiration?: Date;
  pauses: Array<{
    id: string;
    mission: string;
    executionId: string;
    remaining: number;
    remainingFormatted: string;
  }>;
}

/**
 * Create a pause manager
 */
export function createPauseManager(config: PauseManagerConfig): PauseManager {
  return new PauseManager(config);
}
