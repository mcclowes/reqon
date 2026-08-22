import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition, ActionDefinition, WebhookStep } from '../ast/nodes.js';

function parse(source: string) {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens, source);
  return parser.parse();
}

describe('WebhookStep Parser', () => {
  it('should parse a basic wait step', () => {
    const source = `
      mission TestWebhook {
        source API { auth: none, base: "http://localhost" }
        store events: memory("events")

        action WaitForCallback {
          wait {
            timeout: 60000
          }
        }

        run WaitForCallback
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.type).toBe('WebhookStep');
    expect(step.timeout).toBe(60000);
  });

  it('should parse wait step with path', () => {
    const source = `
      mission TestWebhook {
        source API { auth: none, base: "http://localhost" }

        action WaitForCallback {
          wait {
            timeout: 30000,
            path: "/webhooks/callback"
          }
        }

        run WaitForCallback
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.type).toBe('WebhookStep');
    expect(step.timeout).toBe(30000);
    expect(step.path).toBe('/webhooks/callback');
  });

  it('should parse wait step with expectedEvents', () => {
    const source = `
      mission TestWebhook {
        source API { auth: none, base: "http://localhost" }

        action WaitForMultiple {
          wait {
            timeout: 120000,
            expectedEvents: 3
          }
        }

        run WaitForMultiple
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.expectedEvents).toBe(3);
  });

  it('should parse wait step with storage configuration', () => {
    const source = `
      mission TestWebhook {
        source API { auth: none, base: "http://localhost" }
        store webhook_events: memory("events")

        action WaitAndStore {
          wait {
            timeout: 60000,
            storage: {
              target: webhook_events,
              key: .id
            }
          }
        }

        run WaitAndStore
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.storage).toBeDefined();
    expect(step.storage?.target).toBe('webhook_events');
    expect(step.storage?.key).toBeDefined();
  });

  it('should parse wait step with retry configuration', () => {
    const source = `
      mission TestWebhook {
        source API { auth: none, base: "http://localhost" }

        action WaitWithRetry {
          wait {
            timeout: 30000,
            retry: {
              maxAttempts: 3,
              backoff: exponential,
              initialDelay: 1000
            }
          }
        }

        run WaitWithRetry
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.retryOnTimeout).toBeDefined();
    expect(step.retryOnTimeout?.maxAttempts).toBe(3);
    expect(step.retryOnTimeout?.backoff).toBe('exponential');
    expect(step.retryOnTimeout?.initialDelay).toBe(1000);
  });

  it('should parse wait step with eventFilter', () => {
    const source = `
      mission TestWebhook {
        source API { auth: none, base: "http://localhost" }

        action WaitFiltered {
          wait {
            timeout: 60000,
            eventFilter: .type == "payment.completed"
          }
        }

        run WaitFiltered
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.eventFilter).toBeDefined();
  });

  it('should parse wait step with all options', () => {
    const source = `
      mission FullWebhook {
        source API { auth: none, base: "http://localhost" }
        store events: memory("events")

        action CompleteWait {
          wait {
            timeout: 300000,
            path: "/webhooks/payment",
            expectedEvents: 1,
            eventFilter: .status == "success",
            storage: {
              target: events,
              key: .id
            },
            retry: {
              maxAttempts: 5,
              backoff: linear,
              initialDelay: 2000
            }
          }
        }

        run CompleteWait
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const step = action.steps[0] as WebhookStep;

    expect(step.type).toBe('WebhookStep');
    expect(step.timeout).toBe(300000);
    expect(step.path).toBe('/webhooks/payment');
    expect(step.expectedEvents).toBe(1);
    expect(step.eventFilter).toBeDefined();
    expect(step.storage?.target).toBe('events');
    expect(step.retryOnTimeout?.maxAttempts).toBe(5);
  });

  it('should parse wait step in a multi-step action', () => {
    const source = `
      mission WorkflowWithWebhook {
        source API { auth: none, base: "http://localhost" }
        store orders: memory("orders")

        action ProcessOrder {
          post "/orders"

          wait {
            timeout: 60000,
            path: "/webhooks/order-confirmed"
          }

          store response -> orders { key: .id }
        }

        run ProcessOrder
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;

    expect(action.steps).toHaveLength(3);
    expect(action.steps[0].type).toBe('FetchStep');
    expect(action.steps[1].type).toBe('WebhookStep');
    expect(action.steps[2].type).toBe('StoreStep');
  });
});
