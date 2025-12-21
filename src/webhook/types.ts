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
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
  /** Base URL for webhook endpoints (e.g., 'https://example.com/webhooks') */
  baseUrl?: string;
  /** Default timeout for webhook registrations in ms (default: 300000 = 5 min) */
  defaultTimeout?: number;
  /** Enable verbose logging */
  verbose?: boolean;
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
