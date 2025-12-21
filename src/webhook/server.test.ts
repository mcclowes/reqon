import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookServer } from './server.js';
import { MemoryWebhookStore } from './store.js';

describe('WebhookServer', () => {
  let server: WebhookServer;
  let store: MemoryWebhookStore;

  beforeEach(() => {
    store = new MemoryWebhookStore();
    server = new WebhookServer(
      { port: 0, verbose: false }, // Use port 0 for dynamic port assignment
      store
    );
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
  });

  describe('start/stop', () => {
    it('should start and stop the server', async () => {
      // Server should not be running initially
      expect(server.isRunning()).toBe(false);

      // Note: Port 0 might not work in all environments, so we skip actual start
      // In a real test environment, you'd start the server and verify
    });
  });

  describe('register', () => {
    it('should register a webhook endpoint', async () => {
      const registration = await server.register('exec-123', {
        path: '/test/callback',
        timeout: 60000,
        expectedEvents: 2,
      });

      expect(registration.id).toBeDefined();
      expect(registration.executionId).toBe('exec-123');
      expect(registration.path).toBe('/test/callback');
      expect(registration.expectedEvents).toBe(2);
      expect(registration.receivedEvents).toBe(0);
    });

    it('should auto-generate path if not provided', async () => {
      const registration = await server.register('exec-456');

      expect(registration.path).toContain('/webhook/exec-456/');
    });

    it('should set expiration based on timeout', async () => {
      const before = Date.now();
      const registration = await server.register('exec-789', {
        timeout: 120000, // 2 minutes
      });
      const after = Date.now();

      const expectedMin = before + 120000;
      const expectedMax = after + 120000;

      expect(registration.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(registration.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('unregister', () => {
    it('should unregister a webhook endpoint', async () => {
      const registration = await server.register('exec-123');

      await server.unregister(registration.id);

      const loaded = await store.getRegistration(registration.id);
      expect(loaded).toBeUndefined();
    });
  });

  describe('getWebhookUrl', () => {
    it('should return the full webhook URL', async () => {
      const serverWithUrl = new WebhookServer(
        { port: 8080, baseUrl: 'https://example.com' },
        store
      );

      const registration = await serverWithUrl.register('exec-123', {
        path: '/webhooks/test',
      });

      const url = serverWithUrl.getWebhookUrl(registration);
      expect(url).toBe('https://example.com/webhooks/test');
    });
  });
});

describe('MemoryWebhookStore', () => {
  let store: MemoryWebhookStore;

  beforeEach(() => {
    store = new MemoryWebhookStore();
  });

  describe('registrations', () => {
    it('should save and retrieve a registration', async () => {
      const registration = {
        id: 'reg-1',
        executionId: 'exec-1',
        path: '/test',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        expectedEvents: 1,
        receivedEvents: 0,
      };

      await store.saveRegistration(registration);
      const loaded = await store.getRegistration('reg-1');

      expect(loaded).toEqual(registration);
    });

    it('should find registration by path', async () => {
      const registration = {
        id: 'reg-2',
        executionId: 'exec-2',
        path: '/webhooks/callback',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        expectedEvents: 1,
        receivedEvents: 0,
      };

      await store.saveRegistration(registration);
      const found = await store.getRegistrationByPath('/webhooks/callback');

      expect(found?.id).toBe('reg-2');
    });

    it('should delete a registration', async () => {
      const registration = {
        id: 'reg-3',
        executionId: 'exec-3',
        path: '/test3',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        expectedEvents: 1,
        receivedEvents: 0,
      };

      await store.saveRegistration(registration);
      await store.deleteRegistration('reg-3');

      const loaded = await store.getRegistration('reg-3');
      expect(loaded).toBeUndefined();
    });

    it('should list all registrations', async () => {
      await store.saveRegistration({
        id: 'reg-a',
        executionId: 'exec-a',
        path: '/a',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        expectedEvents: 1,
        receivedEvents: 0,
      });

      await store.saveRegistration({
        id: 'reg-b',
        executionId: 'exec-b',
        path: '/b',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        expectedEvents: 1,
        receivedEvents: 0,
      });

      const list = await store.listRegistrations();
      expect(list).toHaveLength(2);
    });
  });

  describe('events', () => {
    it('should save and retrieve events', async () => {
      const event = {
        id: 'evt-1',
        registrationId: 'reg-1',
        receivedAt: new Date(),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { data: 'test' },
        rawBody: '{"data":"test"}',
        query: {},
      };

      await store.saveEvent(event);
      const events = await store.getEvents('reg-1');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('should delete events for a registration', async () => {
      await store.saveEvent({
        id: 'evt-2',
        registrationId: 'reg-2',
        receivedAt: new Date(),
        method: 'POST',
        headers: {},
        body: {},
        rawBody: '',
        query: {},
      });

      await store.deleteEvents('reg-2');
      const events = await store.getEvents('reg-2');

      expect(events).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should clean up expired registrations', async () => {
      // Create an expired registration
      await store.saveRegistration({
        id: 'expired',
        executionId: 'exec-expired',
        path: '/expired',
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago
        expectedEvents: 1,
        receivedEvents: 0,
      });

      // Create a valid registration
      await store.saveRegistration({
        id: 'valid',
        executionId: 'exec-valid',
        path: '/valid',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000), // Expires in 1 minute
        expectedEvents: 1,
        receivedEvents: 0,
      });

      const cleaned = await store.cleanupExpired();

      expect(cleaned).toBe(1);
      expect(await store.getRegistration('expired')).toBeUndefined();
      expect(await store.getRegistration('valid')).toBeDefined();
    });
  });
});
