/**
 * Webhook Server
 *
 * HTTP server for receiving webhook callbacks.
 * Supports dynamic registration of webhook endpoints.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  WebhookServerConfig,
  WebhookServerCallbacks,
  WebhookRegistration,
  WebhookEvent,
  WaitResult,
} from './types.js';
import type { WebhookStore } from './store.js';
import { MemoryWebhookStore } from './store.js';

/**
 * Pending wait request
 */
interface PendingWait {
  registrationId: string;
  resolve: (result: WaitResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Webhook Server
 *
 * Provides HTTP endpoints for receiving webhook callbacks.
 */
export class WebhookServer {
  private config: Required<WebhookServerConfig>;
  private store: WebhookStore;
  private callbacks: WebhookServerCallbacks;
  private server?: Server;
  private pendingWaits: Map<string, PendingWait> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    config: WebhookServerConfig = {},
    store?: WebhookStore,
    callbacks: WebhookServerCallbacks = {}
  ) {
    this.config = {
      port: config.port ?? 3000,
      host: config.host ?? '0.0.0.0',
      baseUrl: config.baseUrl ?? `http://localhost:${config.port ?? 3000}`,
      defaultTimeout: config.defaultTimeout ?? 300000, // 5 minutes
      verbose: config.verbose ?? false,
    };
    this.store = store ?? new MemoryWebhookStore();
    this.callbacks = callbacks;
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    if (this.running) return;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.log(`Webhook server listening on ${this.config.host}:${this.config.port}`);

        // Start cleanup interval (every minute)
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);

        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Cancel all pending waits
    for (const [id, pending] of this.pendingWaits) {
      clearTimeout(pending.timeoutId);
      pending.resolve({
        success: false,
        events: [],
        error: 'Server shutting down',
      });
    }
    this.pendingWaits.clear();

    // Close server
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.running = false;
          this.log('Webhook server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Register a webhook endpoint
   */
  async register(
    executionId: string,
    options: {
      path?: string;
      timeout?: number;
      expectedEvents?: number;
      filter?: string;
    } = {}
  ): Promise<WebhookRegistration> {
    const id = randomUUID();
    const timeout = options.timeout ?? this.config.defaultTimeout;
    const path = options.path ?? `/webhook/${executionId}/${id}`;

    const registration: WebhookRegistration = {
      id,
      executionId,
      path,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + timeout),
      expectedEvents: options.expectedEvents ?? 1,
      receivedEvents: 0,
      filter: options.filter,
    };

    await this.store.saveRegistration(registration);
    this.callbacks.onRegistrationCreated?.(registration);
    this.log(`Registered webhook: ${path} (expires: ${registration.expiresAt.toISOString()})`);

    return registration;
  }

  /**
   * Get the full URL for a webhook endpoint
   */
  getWebhookUrl(registration: WebhookRegistration): string {
    return `${this.config.baseUrl}${registration.path}`;
  }

  /**
   * Wait for webhook events
   */
  async waitForEvents(
    registrationId: string,
    timeout?: number
  ): Promise<WaitResult> {
    const registration = await this.store.getRegistration(registrationId);
    if (!registration) {
      return {
        success: false,
        events: [],
        error: `Registration not found: ${registrationId}`,
      };
    }

    // Check if already received enough events
    const events = await this.store.getEvents(registrationId);
    if (events.length >= registration.expectedEvents) {
      return { success: true, events };
    }

    // Wait for more events
    const waitTimeout = timeout ?? (registration.expiresAt.getTime() - Date.now());

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingWaits.delete(registrationId);
        this.store.getEvents(registrationId).then((events) => {
          resolve({
            success: events.length >= registration.expectedEvents,
            events,
            timedOut: true,
          });
        });
      }, waitTimeout);

      this.pendingWaits.set(registrationId, {
        registrationId,
        resolve,
        timeoutId,
      });
    });
  }

  /**
   * Unregister a webhook endpoint
   */
  async unregister(registrationId: string): Promise<void> {
    await this.store.deleteRegistration(registrationId);
    await this.store.deleteEvents(registrationId);

    // Cancel pending wait if any
    const pending = this.pendingWaits.get(registrationId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingWaits.delete(registrationId);
    }

    this.log(`Unregistered webhook: ${registrationId}`);
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = parseUrl(req.url ?? '/', true);
    const path = url.pathname ?? '/';

    // Health check endpoint
    if (path === '/health' || path === '/_health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    // Find matching registration
    const registration = await this.store.getRegistrationByPath(path);
    if (!registration) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', path }));
      return;
    }

    // Check if registration is expired
    if (registration.expiresAt < new Date()) {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook registration expired' }));
      await this.store.deleteRegistration(registration.id);
      return;
    }

    // Parse request body
    let rawBody = '';
    let body: unknown = null;

    try {
      rawBody = await this.readBody(req);
      if (rawBody) {
        const contentType = req.headers['content-type'] ?? '';
        if (contentType.includes('application/json')) {
          body = JSON.parse(rawBody);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          body = Object.fromEntries(new URLSearchParams(rawBody));
        } else {
          body = rawBody;
        }
      }
    } catch (error) {
      body = rawBody;
    }

    // Create event
    const event: WebhookEvent = {
      id: randomUUID(),
      registrationId: registration.id,
      receivedAt: new Date(),
      method: req.method ?? 'POST',
      headers: this.extractHeaders(req),
      body,
      rawBody,
      query: url.query as Record<string, string>,
    };

    // Save event
    await this.store.saveEvent(event);
    registration.receivedEvents++;
    await this.store.saveRegistration(registration);

    this.log(`Webhook received: ${path} (${registration.receivedEvents}/${registration.expectedEvents})`);
    this.callbacks.onWebhookReceived?.(event);

    // Check if all expected events received
    if (registration.receivedEvents >= registration.expectedEvents) {
      const events = await this.store.getEvents(registration.id);
      this.callbacks.onRegistrationComplete?.(registration, events);

      // Resolve pending wait
      const pending = this.pendingWaits.get(registration.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingWaits.delete(registration.id);
        pending.resolve({ success: true, events });
      }
    }

    // Send response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      eventId: event.id,
      received: registration.receivedEvents,
      expected: registration.expectedEvents,
    }));
  }

  /**
   * Read request body
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        resolve(data);
      });
      req.on('error', reject);
    });
  }

  /**
   * Extract headers from request
   */
  private extractHeaders(req: IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    }
    return headers;
  }

  /**
   * Clean up expired registrations
   */
  private async cleanup(): Promise<void> {
    const cleaned = await this.store.cleanupExpired();
    if (cleaned > 0) {
      this.log(`Cleaned up ${cleaned} expired webhook registration(s)`);
    }
  }

  /**
   * Log message if verbose mode enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Webhook] ${message}`);
    }
  }
}
