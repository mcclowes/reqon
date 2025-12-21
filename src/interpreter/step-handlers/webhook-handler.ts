/**
 * Webhook Handler
 *
 * Handles the 'wait' step for waiting on webhook callbacks.
 */

import type { WebhookStep } from '../../ast/nodes.js';
import type { ExecutionContext } from '../context.js';
import { evaluate } from '../evaluator.js';
import type { WebhookServer, WebhookRegistration, WebhookEvent } from '../../webhook/index.js';
import { RetrySignal } from '../signals.js';
import type { EventType } from '../../observability/index.js';

/**
 * Dependencies for the webhook handler
 */
export interface WebhookHandlerDeps {
  ctx: ExecutionContext;
  webhookServer: WebhookServer;
  executionId: string;
  log: (message: string) => void;
  /** Optional event emitter for observability */
  emit?: <T>(type: EventType, payload: T) => void;
}

/**
 * Result of webhook handler execution
 */
export interface WebhookHandlerResult {
  registration: WebhookRegistration;
  events: WebhookEvent[];
  webhookUrl: string;
}

/**
 * Handler for webhook (wait) steps
 */
export class WebhookHandler {
  private deps: WebhookHandlerDeps;

  constructor(deps: WebhookHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Execute the wait step
   */
  async execute(step: WebhookStep): Promise<WebhookHandlerResult> {
    const { ctx, webhookServer, executionId, log, emit } = this.deps;

    // Register webhook endpoint
    const timeout = step.timeout ?? 300000; // 5 minutes default
    const expectedEvents = step.expectedEvents ?? 1;

    const registration = await webhookServer.register(executionId, {
      path: step.path,
      timeout,
      expectedEvents,
      filter: step.eventFilter ? JSON.stringify(step.eventFilter) : undefined,
    });

    const webhookUrl = webhookServer.getWebhookUrl(registration);
    log(`Waiting for webhook: ${webhookUrl} (timeout: ${timeout}ms, expected: ${expectedEvents})`);

    // Emit webhook.register event
    emit?.('webhook.register', {
      registrationId: registration.id,
      path: registration.path,
      webhookUrl,
      timeout,
      expectedEvents,
    });

    // Set the webhook URL in context for use in subsequent steps
    ctx.response = {
      webhookId: registration.id,
      webhookUrl,
      webhookPath: registration.path,
    };

    // Wait for webhook events
    const result = await webhookServer.waitForEvents(registration.id, timeout);

    if (result.timedOut) {
      log(`Webhook timeout: ${webhookUrl}`);

      // Check if retry is configured
      if (step.retryOnTimeout) {
        throw new RetrySignal(step.retryOnTimeout);
      }

      // If not retrying, still return partial results
      if (result.events.length === 0) {
        throw new Error(`Webhook timeout: no events received within ${timeout}ms`);
      }
    }

    // Filter events if filter expression provided
    let events = result.events;
    if (step.eventFilter && events.length > 0) {
      events = events.filter((event) => {
        try {
          const filterCtx = { ...ctx, response: event.body };
          return evaluate(step.eventFilter!, filterCtx);
        } catch {
          return true; // Include on filter error
        }
      });
    }

    log(`Received ${events.length} webhook event(s)`);

    // Set response to webhook events
    if (events.length === 1) {
      ctx.response = events[0].body;
    } else {
      ctx.response = events.map((e) => e.body);
    }

    // Store events if storage configured
    if (step.storage) {
      const store = ctx.stores.get(step.storage.target);
      if (store) {
        for (const event of events) {
          const data = event.body as Record<string, unknown>;
          let key: string;

          if (step.storage.key) {
            const keyCtx = { ...ctx, response: event.body };
            const keyValue = evaluate(step.storage.key, keyCtx);
            key = String(keyValue);
          } else {
            // Generate a key from the event ID
            key = event.id;
          }

          await store.set(key, data);
          log(`Stored webhook event: ${key}`);
        }
      } else {
        log(`Warning: Store '${step.storage.target}' not found for webhook storage`);
      }
    }

    // Emit webhook.complete event
    emit?.('webhook.complete', {
      registrationId: registration.id,
      eventsReceived: events.length,
      timedOut: result.timedOut ?? false,
      storedTo: step.storage?.target,
    });

    // Clean up registration
    await webhookServer.unregister(registration.id);

    return {
      registration,
      events,
      webhookUrl,
    };
  }
}
