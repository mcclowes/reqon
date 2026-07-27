/**
 * Webhook Module Types
 *
 * Types for webhook server and storage components.
 */

/**
 * Represents a pending webhook registration
 */
export interface WebhookRegistration {
  /** Unique ID for this webhook registration */
  id: string;
  /** Execution ID that registered this webhook */
  executionId: string;
  /** Path for the webhook endpoint */
  path: string;
  /** When the registration was created */
  createdAt: Date;
  /** When the registration expires */
  expiresAt: Date;
  /** Number of events expected */
  expectedEvents: number;
  /** Number of events received so far */
  receivedEvents: number;
  /** Filter expression (serialized) */
  filter?: string;
}

/**
 * Represents a received webhook event
 */
export interface WebhookEvent {
  /** Unique ID for this event */
  id: string;
  /** Registration ID this event belongs to */
  registrationId: string;
  /** Received timestamp */
  receivedAt: Date;
  /** HTTP method used */
  method: string;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body (parsed if JSON) */
  body: unknown;
  /** Raw body string */
  rawBody: string;
  /** Query parameters */
  query: Record<string, string>;
}

/**
 * Configuration for the webhook server
 */
export interface WebhookServerConfig {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Host to bind to (default: '127.0.0.1' — loopback only) */
  host?: string;
  /** Base URL for webhook endpoints (e.g., 'https://example.com/webhooks') */
  baseUrl?: string;
  /** Default timeout for webhook registrations in ms (default: 300000 = 5 min) */
  defaultTimeout?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /**
   * Shared secret required on inbound webhook requests. When set, a request must
   * present it via `Authorization: Bearer <secret>` or the `X-Webhook-Token`
   * header, or it is rejected with 401. Compared in constant time.
   *
   * The secret is never accepted in a query parameter: query strings land in
   * access logs, proxy logs, and `Referer` headers, so a leaked URL would be a
   * permanent forgery capability.
   */
  secret?: string;
  /**
   * Secret for per-payload HMAC-SHA256 signature verification. When set, every
   * inbound request must carry a valid `HMAC-SHA256(raw body)` signature in the
   * `signatureHeader`, or it is rejected with 401. This authenticates the
   * *message* (this exact payload, unmodified) rather than only the channel, the
   * shape Stripe/GitHub/Shopify use. Independent of, and combinable with, `secret`.
   */
  signingSecret?: string;
  /** Header carrying the HMAC signature (default: 'x-webhook-signature'). */
  signatureHeader?: string;
  /**
   * HTTP methods that count as a delivered event (default: ['POST', 'PUT']).
   * Everything else gets 405. GET must stay safe and idempotent — a crawler,
   * link-preview bot, or scanner hitting the URL must never resolve a wait.
   */
  allowedMethods?: string[];
  /** Maximum accepted request body size in bytes (default 1 MiB) */
  maxBodyBytes?: number;
}

/**
 * Callbacks for webhook server events
 */
export interface WebhookServerCallbacks {
  /** Called when a webhook is received */
  onWebhookReceived?: (event: WebhookEvent) => void;
  /** Called when a registration is created */
  onRegistrationCreated?: (registration: WebhookRegistration) => void;
  /** Called when a registration expires */
  onRegistrationExpired?: (registration: WebhookRegistration) => void;
  /** Called when all expected events are received */
  onRegistrationComplete?: (registration: WebhookRegistration, events: WebhookEvent[]) => void;
}

/**
 * Result of waiting for webhook events
 */
export interface WaitResult {
  /** Whether the wait was successful */
  success: boolean;
  /** Events received */
  events: WebhookEvent[];
  /** Error message if failed */
  error?: string;
  /** Whether timed out */
  timedOut?: boolean;
}
