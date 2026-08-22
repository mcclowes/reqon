/**
 * Pause Orchestrator - the trigger side of resource-free long pauses.
 *
 * A pause records its deadline and resume triggers, then the run stops. This is
 * the component that turns those recorded triggers back into running missions:
 * it routes inbound webhooks on a waiting pause's path into a resume, polls for
 * expired timeout pauses, and hands each resumed pause to a host-supplied
 * `resume` callback (typically `execute({ resumeFrom })`).
 *
 * The orchestrator only needs to share the *pause store* and *webhook server*
 * with the executor that created the pauses — not the executor's own
 * PauseManager instance. It builds its own manager over the shared store, so
 * the persisted-status claim in `markResumed` keeps resume exactly-once.
 */

import type { WebhookServer } from '../webhook/index.js';
import type { PauseStore } from './store.js';
import type { PauseState } from './state.js';
import { PauseManager } from './manager.js';
import { getRemainingTime } from './state.js';

export interface PauseOrchestratorConfig {
  /** Pause store shared with the executor(s) whose pauses this orchestrates. */
  store: PauseStore;
  /** Webhook server shared with the executor(s); required for webhook triggers. */
  webhookServer?: WebhookServer;
  /** Polling interval for the timeout monitor in ms (default: 1 minute). */
  pollInterval?: number;
  /**
   * Invoked once per resumed pause. This is where the host re-invokes
   * execution, e.g. `execute(source, { ...config, resumeFrom: pause.executionId })`.
   * The pause is already marked resumed when this fires; if the callback
   * throws, the run stays recoverable via a manual resume of the execution.
   */
  resume: (pause: PauseState) => void | Promise<void>;
  /** Called when the resume callback throws. */
  onResumeError?: (error: Error, pause: PauseState) => void;
  /** Logger function */
  log?: (message: string) => void;
}

/**
 * Wires a webhook server and a pause store into automatic resumes.
 */
export class PauseOrchestrator {
  /** The manager driving resumes; shares the host's pause store. */
  readonly manager: PauseManager;

  private config: PauseOrchestratorConfig;
  private unsubscribeWebhook?: () => void;
  private started = false;

  constructor(config: PauseOrchestratorConfig) {
    this.config = config;
    this.manager = new PauseManager({
      store: config.store,
      webhookServer: config.webhookServer,
      pollInterval: config.pollInterval,
      log: config.log,
      onResume: (pause) => this.dispatchResume(pause),
    });
  }

  /**
   * Start orchestrating: subscribe to webhook deliveries, recover waiting
   * pauses (missing registrations, already-delivered events), and begin the
   * timeout poll — including an immediate sweep so pauses that expired while
   * nothing was running resume without waiting a full poll tick.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (this.config.webhookServer) {
      this.unsubscribeWebhook = this.config.webhookServer.onEvent((event) => {
        this.manager.handleWebhookEvent(event).catch((error: Error) => {
          this.log(`Webhook routing failed: ${error.message}`);
        });
      });
    }

    await this.recoverWaitingPauses();

    this.manager.startMonitoring();
    await this.manager.checkExpiredPauses();
  }

  /** Stop the timeout poll and detach from the webhook server. */
  stop(): void {
    this.manager.stopMonitoring();
    this.unsubscribeWebhook?.();
    this.unsubscribeWebhook = undefined;
    this.started = false;
  }

  /**
   * Reconnect waiting pauses to the webhook server.
   *
   * Covers two gaps a live subscription can't:
   * - A delivery that landed before this orchestrator started (the event is
   *   persisted on the registration) resumes the pause now.
   * - A registration lost to a restart (or never created because no webhook
   *   server was configured at pause time) is re-registered on the same path,
   *   so retried deliveries land. The fresh registration id is deliberately
   *   not written back to the pause — event routing matches by path, and a
   *   log-backed store records updates as resume events.
   */
  private async recoverWaitingPauses(): Promise<void> {
    const server = this.config.webhookServer;
    if (!server) return;

    for (const pause of await this.config.store.listActive()) {
      for (const trigger of pause.resumeTriggers) {
        if (trigger.type !== 'webhook' || !trigger.active || !trigger.path) continue;

        const registration = await server.getRegistrationByPath(trigger.path);
        if (registration) {
          const events = await server.getEvents(registration.id);
          if (events.length > 0) {
            this.log(`Pause ${pause.id}: webhook already delivered on ${trigger.path}`);
            await this.manager.handleWebhook(pause.id, events[0].body);
          }
        } else {
          await server.register(pause.executionId, {
            path: trigger.path,
            timeout: Math.max(getRemainingTime(pause), 1000),
            expectedEvents: 1,
          });
          this.log(`Pause ${pause.id}: re-registered webhook ${trigger.path}`);
        }
      }
    }
  }

  /**
   * Hand a resumed pause to the host. Never throws: `onResume` is awaited
   * inside `markResumed`, which runs off a timer or an HTTP listener — an
   * uncaught error there would be an unhandled rejection, not a failed resume.
   */
  private async dispatchResume(pause: PauseState): Promise<void> {
    try {
      await this.config.resume(pause);
    } catch (error) {
      this.config.onResumeError?.(error as Error, pause);
      this.log(
        `Resume failed for pause ${pause.id} (execution ${pause.executionId}): ` +
          `${(error as Error).message}. The pause is marked resumed; ` +
          `re-run with resumeFrom to recover.`
      );
    }
  }

  private log(message: string): void {
    this.config.log?.(`[PauseOrchestrator] ${message}`);
  }
}

/**
 * Create a pause orchestrator
 */
export function createPauseOrchestrator(config: PauseOrchestratorConfig): PauseOrchestrator {
  return new PauseOrchestrator(config);
}
