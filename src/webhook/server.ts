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
import { WEBHOOK_DEFAULTS } from '../config/index.js';

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
  // Multiple concurrent waiters may await the same registration; each gets its
  // own entry so a second waiter can't clobber the first's timer/promise.
  private pendingWaits: Map<string, Set<PendingWait>> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    config: WebhookServerConfig = {},
    store?: WebhookStore,
    callbacks: WebhookServerCallbacks = {}
  ) {
    this.config = {
      port: config.port ?? WEBHOOK_DEFAULTS.PORT,
      host: config.host ?? WEBHOOK_DEFAULTS.HOST,
      baseUrl: config.baseUrl ?? `http://localhost:${config.port ?? WEBHOOK_DEFAULTS.PORT}`,
      defaultTimeout: config.defaultTimeout ?? WEBHOOK_DEFAULTS.DEFAULT_TIMEOUT_MS,
      verbose: config.verbose ?? false,
      secret: config.secret ?? '',
      maxBodyBytes: config.maxBodyBytes ?? WEBHOOK_DEFAULTS.MAX_BODY_BYTES,
    };
    this.store = store ?? new MemoryWebhookStore();
    this.callbacks = callbacks;
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Warn loudly if exposing an unauthenticated webhook server off-host.
    if (!this.isLoopback(this.config.host) && !this.config.secret) {
      console.warn(
        `[Webhook] WARNING: binding to ${this.config.host} with no secret — ` +
          `anyone who can reach the port can inject events.`
      );
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.setTimeout(WEBHOOK_DEFAULTS.SOCKET_TIMEOUT_MS);

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.log(`Webhook server listening on ${this.config.host}:${this.config.port}`);

        // Start cleanup interval
        this.cleanupInterval = setInterval(
          () => this.cleanup(),
          WEBHOOK_DEFAULTS.CLEANUP_INTERVAL_MS
        );

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
    for (const [, waiters] of this.pendingWaits) {
      for (const pending of waiters) {
        clearTimeout(pending.timeoutId);
        pending.resolve({
          success: false,
          events: [],
          error: 'Server shutting down',
        });
      }
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
  async waitForEvents(registrationId: string, timeout?: number): Promise<WaitResult> {
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
    const waitTimeout = timeout ?? registration.expiresAt.getTime() - Date.now();

    return new Promise((resolve) => {
      const pending: PendingWait = { registrationId, resolve, timeoutId: undefined! };
      pending.timeoutId = setTimeout(() => {
        this.removePendingWait(registrationId, pending);
        this.store.getEvents(registrationId).then((events) => {
          resolve({
            success: events.length >= registration.expectedEvents,
            events,
            timedOut: true,
          });
        });
      }, waitTimeout);

      let waiters = this.pendingWaits.get(registrationId);
      if (!waiters) {
        waiters = new Set();
        this.pendingWaits.set(registrationId, waiters);
      }
      waiters.add(pending);
    });
  }

  /** Remove a single waiter, dropping the registration's set when empty. */
  private removePendingWait(registrationId: string, pending: PendingWait): void {
    const waiters = this.pendingWaits.get(registrationId);
    if (!waiters) return;
    waiters.delete(pending);
    if (waiters.size === 0) {
      this.pendingWaits.delete(registrationId);
    }
  }

  /**
   * Unregister a webhook endpoint
   */
  async unregister(registrationId: string): Promise<void> {
    await this.store.deleteRegistration(registrationId);
    await this.store.deleteEvents(registrationId);

    // Cancel any pending waits for this registration.
    const waiters = this.pendingWaits.get(registrationId);
    if (waiters) {
      for (const pending of waiters) {
        clearTimeout(pending.timeoutId);
      }
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

    // Require the shared secret if one is configured.
    if (this.config.secret && !this.authorized(req, url.query)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Read the request body with a hard size cap to prevent an OOM from a
    // large or slow-drip POST.
    let rawBody = '';
    try {
      rawBody = await this.readBody(req);
    } catch (error) {
      if ((error as { code?: string }).code === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }

    // Parse request body
    let body: unknown = null;
    try {
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
    } catch {
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

    this.log(
      `Webhook received: ${path} (${registration.receivedEvents}/${registration.expectedEvents})`
    );
    this.callbacks.onWebhookReceived?.(event);

    // Check if all expected events received
    if (registration.receivedEvents >= registration.expectedEvents) {
      const events = await this.store.getEvents(registration.id);
      this.callbacks.onRegistrationComplete?.(registration, events);

      // Resolve every pending waiter for this registration.
      const waiters = this.pendingWaits.get(registration.id);
      if (waiters) {
        this.pendingWaits.delete(registration.id);
        for (const pending of waiters) {
          clearTimeout(pending.timeoutId);
          pending.resolve({ success: true, events });
        }
      }
    }

    // Send response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        eventId: event.id,
        received: registration.receivedEvents,
        expected: registration.expectedEvents,
      })
    );
  }

  /**
   * Read request body
   */
  private readBody(req: IncomingMessage): Promise<string> {
    const limit = this.config.maxBodyBytes;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > limit) {
          // Stop accumulating (memory stays bounded) and reject; the handler
          // responds 413. We don't destroy the socket here so the response
          // can flush first.
          aborted = true;
          const err = new Error('Request body too large') as Error & { code: string };
          err.code = 'BODY_TOO_LARGE';
          reject(err);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });
      req.on('error', reject);
    });
  }

  /** True if a host string is a loopback address. */
  private isLoopback(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  /**
   * Validate the shared secret from Authorization bearer, X-Webhook-Token
   * header, or a `token` query param.
   */
  private authorized(req: IncomingMessage, query: Record<string, unknown>): boolean {
    const secret = this.config.secret;
    const auth = req.headers.authorization;
    if (auth === `Bearer ${secret}`) return true;
    const tokenHeader = req.headers['x-webhook-token'];
    if (tokenHeader === secret) return true;
    if (typeof query.token === 'string' && query.token === secret) return true;
    return false;
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
