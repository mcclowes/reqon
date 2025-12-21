import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebhookStep } from '../../ast/nodes.js';
import type { Expression } from 'vague-lang';
import { WebhookHandler, type WebhookHandlerDeps } from './webhook-handler.js';
import { createContext } from '../context.js';
import type { WebhookServer, WebhookRegistration, WebhookEvent } from '../../webhook/index.js';
import { MemoryStore } from '../../stores/memory.js';
import { RetrySignal } from '../signals.js';

describe('WebhookHandler', () => {
  let deps: WebhookHandlerDeps;
  let mockWebhookServer: WebhookServer;
  let registrations: Map<string, WebhookRegistration>;
  let pendingEvents: Map<string, WebhookEvent[]>;

  beforeEach(() => {
    registrations = new Map();
    pendingEvents = new Map();

    mockWebhookServer = {
      register: vi.fn(async (executionId: string, options: {
        path?: string;
        timeout: number;
        expectedEvents: number;
        filter?: string;
      }): Promise<WebhookRegistration> => {
        const reg: WebhookRegistration = {
          id: `webhook-${Date.now()}`,
          executionId,
          path: options.path ?? `/hooks/${executionId}`,
          createdAt: new Date(),
          timeout: options.timeout,
          expectedEvents: options.expectedEvents,
        };
        registrations.set(reg.id, reg);
        return reg;
      }),

      unregister: vi.fn(async (id: string) => {
        registrations.delete(id);
      }),

      getWebhookUrl: vi.fn((reg: WebhookRegistration) => {
        return `https://webhooks.example.com${reg.path}`;
      }),

      waitForEvents: vi.fn(async (id: string, timeout: number) => {
        const events = pendingEvents.get(id) ?? [];
        return {
          events,
          timedOut: events.length === 0,
        };
      }),
    } as unknown as WebhookServer;

    deps = {
      ctx: createContext(),
      webhookServer: mockWebhookServer,
      executionId: 'exec-123',
      log: vi.fn(),
    };
  });

  describe('webhook registration', () => {
    it('registers webhook with default options', async () => {
      // Setup events to prevent timeout
      pendingEvents.set('webhook-', [{ id: 'evt-1', body: { data: 'test' }, receivedAt: new Date() }]);
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: { data: 'test' }, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(mockWebhookServer.register).toHaveBeenCalledWith('exec-123', {
        path: undefined,
        timeout: 300000, // 5 minutes default
        expectedEvents: 1,
        filter: undefined,
      });
    });

    it('registers webhook with custom path', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: {}, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        path: '/custom/webhook/path',
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(mockWebhookServer.register).toHaveBeenCalledWith('exec-123', expect.objectContaining({
        path: '/custom/webhook/path',
      }));
    });

    it('registers webhook with custom timeout', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: {}, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        timeout: 60000, // 1 minute
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(mockWebhookServer.register).toHaveBeenCalledWith('exec-123', expect.objectContaining({
        timeout: 60000,
      }));
    });

    it('registers webhook with expected events count', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-1', body: {}, receivedAt: new Date() },
          { id: 'evt-2', body: {}, receivedAt: new Date() },
          { id: 'evt-3', body: {}, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        expectedEvents: 3,
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(mockWebhookServer.register).toHaveBeenCalledWith('exec-123', expect.objectContaining({
        expectedEvents: 3,
      }));
    });
  });

  describe('waiting for events', () => {
    it('waits for webhook events and sets response for single event', async () => {
      const eventBody = { status: 'complete', result: 42 };
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: eventBody, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
      };

      const handler = new WebhookHandler(deps);
      const result = await handler.execute(step);

      expect(deps.ctx.response).toEqual(eventBody);
      expect(result.events).toHaveLength(1);
    });

    it('sets response as array for multiple events', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-1', body: { seq: 1 }, receivedAt: new Date() },
          { id: 'evt-2', body: { seq: 2 }, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        expectedEvents: 2,
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(deps.ctx.response).toEqual([{ seq: 1 }, { seq: 2 }]);
    });

    it('sets webhook URL in context before waiting', async () => {
      let capturedResponse: unknown;
      mockWebhookServer.waitForEvents = vi.fn(async () => {
        capturedResponse = deps.ctx.response;
        return {
          events: [{ id: 'evt-1', body: {}, receivedAt: new Date() }],
          timedOut: false,
        };
      });

      const step: WebhookStep = {
        type: 'WebhookStep',
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(capturedResponse).toHaveProperty('webhookUrl');
      expect(capturedResponse).toHaveProperty('webhookId');
      expect(capturedResponse).toHaveProperty('webhookPath');
    });

    it('logs waiting message', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: {}, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        timeout: 60000,
        expectedEvents: 2,
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for webhook:')
      );
      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('timeout: 60000ms')
      );
    });
  });

  describe('timeout handling', () => {
    it('throws error on timeout with no events', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [],
        timedOut: true,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        timeout: 5000,
      };

      const handler = new WebhookHandler(deps);
      await expect(handler.execute(step)).rejects.toThrow('Webhook timeout: no events received within 5000ms');
    });

    it('throws RetrySignal when retryOnTimeout is configured', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [],
        timedOut: true,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        retryOnTimeout: {
          maxAttempts: 3,
          backoff: 'exponential',
          initialDelay: 1000,
        },
      };

      const handler = new WebhookHandler(deps);

      try {
        await handler.execute(step);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RetrySignal);
        expect((e as RetrySignal).backoff).toEqual({
          maxAttempts: 3,
          backoff: 'exponential',
          initialDelay: 1000,
        });
      }
    });

    it('returns partial results on timeout if some events received', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: { partial: true }, receivedAt: new Date() }],
        timedOut: true,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        expectedEvents: 3,
      };

      const handler = new WebhookHandler(deps);
      const result = await handler.execute(step);

      expect(result.events).toHaveLength(1);
      expect(deps.ctx.response).toEqual({ partial: true });
    });
  });

  describe('event filtering', () => {
    it('filters events based on eventFilter expression', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-1', body: { type: 'success', value: 10 }, receivedAt: new Date() },
          { id: 'evt-2', body: { type: 'error', value: 0 }, receivedAt: new Date() },
          { id: 'evt-3', body: { type: 'success', value: 20 }, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        eventFilter: {
          type: 'BinaryExpression',
          operator: '==',
          left: { type: 'Identifier', name: 'type' },
          right: { type: 'Literal', value: 'success', dataType: 'string' },
        } as Expression,
      };

      const handler = new WebhookHandler(deps);
      const result = await handler.execute(step);

      expect(result.events).toHaveLength(2);
      expect(result.events.every(e => (e.body as Record<string, unknown>).type === 'success')).toBe(true);
    });

    it('includes all events if filter throws error', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-1', body: { data: 'test' }, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        eventFilter: {
          type: 'CallExpression',
          callee: 'unknownFunction', // This will throw
          arguments: [],
        } as Expression,
      };

      const handler = new WebhookHandler(deps);
      const result = await handler.execute(step);

      // Should include the event even though filter threw
      expect(result.events).toHaveLength(1);
    });
  });

  describe('event storage', () => {
    it('stores events to configured store', async () => {
      const store = new MemoryStore('webhookEvents');
      deps.ctx.stores.set('webhookEvents', store);

      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-001', body: { data: 'event1' }, receivedAt: new Date() },
          { id: 'evt-002', body: { data: 'event2' }, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        storage: {
          target: 'webhookEvents',
        },
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      // Events should be stored with their IDs as keys
      const stored1 = await store.get('evt-001');
      const stored2 = await store.get('evt-002');

      expect(stored1).toEqual({ data: 'event1' });
      expect(stored2).toEqual({ data: 'event2' });
    });

    it('stores events with custom key expression', async () => {
      const store = new MemoryStore('webhookEvents');
      deps.ctx.stores.set('webhookEvents', store);

      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-1', body: { orderId: 'ORD-123', status: 'shipped' }, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        storage: {
          target: 'webhookEvents',
          key: { type: 'Identifier', name: 'orderId' } as Expression,
        },
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      const stored = await store.get('ORD-123');
      expect(stored).toEqual({ orderId: 'ORD-123', status: 'shipped' });
    });

    it('logs warning when store not found', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: {}, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        storage: {
          target: 'nonExistentStore',
        },
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith("Warning: Store 'nonExistentStore' not found for webhook storage");
    });

    it('logs when storing events', async () => {
      const store = new MemoryStore('events');
      deps.ctx.stores.set('events', store);

      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [
          { id: 'evt-abc', body: { test: true }, receivedAt: new Date() },
        ],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        storage: {
          target: 'events',
        },
      };

      const handler = new WebhookHandler(deps);
      await handler.execute(step);

      expect(deps.log).toHaveBeenCalledWith('Stored webhook event: evt-abc');
    });
  });

  describe('cleanup', () => {
    it('unregisters webhook after completion', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: {}, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
      };

      const handler = new WebhookHandler(deps);
      const result = await handler.execute(step);

      expect(mockWebhookServer.unregister).toHaveBeenCalledWith(result.registration.id);
    });
  });

  describe('result structure', () => {
    it('returns complete result with registration, events, and URL', async () => {
      mockWebhookServer.waitForEvents = vi.fn(async () => ({
        events: [{ id: 'evt-1', body: { success: true }, receivedAt: new Date() }],
        timedOut: false,
      }));

      const step: WebhookStep = {
        type: 'WebhookStep',
        path: '/my/hook',
      };

      const handler = new WebhookHandler(deps);
      const result = await handler.execute(step);

      expect(result).toHaveProperty('registration');
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('webhookUrl');
      expect(result.registration.executionId).toBe('exec-123');
      expect(result.events).toHaveLength(1);
      expect(result.webhookUrl).toContain('/my/hook');
    });
  });
});
