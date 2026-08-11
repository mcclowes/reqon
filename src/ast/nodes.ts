/**
 * ---
 * purpose: AST node type definitions for Reqon programs
 * exports:
 *   - ReqonProgram, Statement - top-level types
 *   - MissionDefinition, ActionDefinition - pipeline structure
 *   - SourceDefinition, StoreDefinition - resource declarations
 *   - FetchStep, ForStep, MapStep, ValidateStep, etc. - action steps
 * related:
 *   - ../parser/parser.ts - produces these AST nodes
 *   - ../interpreter/executor.ts - executes AST
 *   - vague-lang - Expression, SchemaDefinition from parent DSL
 * ---
 */

import type { Expression, SchemaDefinition, Statement as VagueStatement } from 'vague-lang';

// Reqon extends Vague's statements
export type Statement =
  | VagueStatement
  | MissionDefinition
  | SourceDefinition
  | StoreDefinition
  | ActionDefinition
  | TransformDefinition;

export interface ReqonProgram {
  type: 'ReqonProgram';
  statements: Statement[];
}

// source Xero { auth: oauth2, base: "https://api.xero.com/..." }
// source Xero from "./xero-openapi.yaml" { auth: oauth2 }
export interface SourceDefinition {
  type: 'SourceDefinition';
  name: string;
  specPath?: string; // OAS spec path (URL or file path)
  config: SourceConfig;
}

export interface SourceConfig {
  auth: AuthConfig;
  base?: string; // Optional if using OAS (derived from spec)
  headers?: Record<string, Expression>;
  validateResponses?: boolean; // Validate responses against OAS schema
  rateLimit?: RateLimitSourceConfig; // Rate limiting configuration
  circuitBreaker?: CircuitBreakerSourceConfig; // Circuit breaker configuration
  /**
   * Egress proxies, always normalized to a pool. A bare `proxy: "..."` parses
   * to a one-entry pool; a list rotates round-robin per request attempt so a
   * source's requests spread across several IPs.
   */
  proxy?: Expression[];
}

export interface CircuitBreakerSourceConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in seconds before attempting recovery (default: 30) */
  resetTimeout?: number;
  /** Number of successful requests in half-open to close circuit (default: 2) */
  successThreshold?: number;
  /** Time window in seconds for counting failures (default: 60) */
  failureWindow?: number;
  /**
   * Open when this percentage of requests in the window failed, instead of on
   * an absolute count. Necessary for bulk runs: a fixed `failureThreshold`
   * that suits a handful of requests sits permanently open at thousands per
   * second, where a few failures are ordinary background noise.
   */
  failureRate?: number;
  /** Requests needed in the window before failureRate applies (default: 20) */
  minimumRequests?: number;
}

export interface RateLimitSourceConfig {
  strategy?: 'pause' | 'throttle' | 'fail'; // Default: 'pause'
  maxWait?: number; // Max seconds to wait (default: 300)
  fallbackRpm?: number; // Fallback requests per minute if no headers
  /** Model of the server's limiter, to pace under it rather than react to 429s. */
  model?: RateLimitModelConfig;
}

// model: { type: tokenBucket, capacity: 5000, refill: 300, safety: 0.9 }
export interface RateLimitModelConfig {
  type: 'tokenBucket';
  capacity: number; // burst tolerance (tokens a full bucket holds)
  refill: number; // sustained rate (tokens per second)
  safety?: number; // pace at safety * refill for headroom (default 1.0)
}

export interface AuthConfig {
  type: 'oauth2' | 'bearer' | 'basic' | 'api_key' | 'none';
  // Details resolved at runtime from environment/config
}

// store invoices_cache: nosql("invoices")
// store invoices_sql: sql("accounting.invoices")
// store data: file("data")
// store records: postgrest("records")
export interface StoreDefinition {
  type: 'StoreDefinition';
  name: string;
  storeType: 'nosql' | 'sql' | 'memory' | 'file' | 'postgrest';
  target: string; // collection/table name
  /** Optional write batching for high-throughput fan-out (see BatchConfig). */
  batch?: BatchConfig;
}

// store x: postgrest("t") { batch: 500 }
// store x: postgrest("t") { batch: { size: 500, maxDelay: 200, durability: relaxed } }
export interface BatchConfig {
  /** Flush once this many buffered writes accumulate. */
  size: number;
  /** Also flush a partial buffer this long (ms) after the first buffered write. */
  maxDelay?: number;
  /**
   * `strict` (default): a write is durable before its loop iteration completes.
   * `relaxed`: writes return immediately and flush in the background - faster,
   * but a crash loses whatever is still buffered.
   */
  durability?: 'strict' | 'relaxed';
}

// Schedule configuration for missions
// schedule: every 6 hours
// schedule: cron "0 */6 * * *"
// schedule: at "2025-01-20 09:00 UTC"
export interface ScheduleDefinition {
  type: 'ScheduleDefinition';
  scheduleType: 'interval' | 'cron' | 'once';
  // For interval-based scheduling
  interval?: IntervalSchedule;
  // For cron-based scheduling
  cronExpression?: string;
  // For one-time scheduling
  runAt?: string; // ISO 8601 datetime or parseable date string
  // Optional timezone (defaults to UTC)
  timezone?: string;
  // Maximum concurrent executions (default: 1)
  maxConcurrency?: number;
  // Skip execution if previous run is still running (default: true)
  skipIfRunning?: boolean;
  // Retry configuration for failed scheduled runs
  retryOnFailure?: ScheduleRetryConfig;
}

export interface IntervalSchedule {
  value: number;
  unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks';
}

export interface ScheduleRetryConfig {
  maxRetries: number;
  delaySeconds: number;
}

// Checkpoint configuration for durable execution
// checkpoint: after-step | on-failure
export interface CheckpointConfig {
  type: 'CheckpointConfig';
  /** When to create checkpoints */
  mode: 'after-step' | 'on-failure';
  /** Optional: custom store for checkpoint data (defaults to FileStore) */
  store?: string;
}

// Trace configuration for time-travel debugging
// trace: full
export interface TraceConfig {
  type: 'TraceConfig';
  /** Trace mode - 'full' captures state at each step */
  mode: 'full' | 'minimal';
  /** Optional: custom store for trace data */
  store?: string;
}

// mission SyncXeroInvoices { ... }
export interface MissionDefinition {
  type: 'MissionDefinition';
  name: string;
  schedule?: ScheduleDefinition;
  /** Checkpoint configuration for durable execution */
  checkpoint?: CheckpointConfig;
  /** Trace configuration for time-travel debugging */
  trace?: TraceConfig;
  sources: SourceDefinition[];
  stores: StoreDefinition[];
  schemas: SchemaDefinition[];
  transforms: TransformDefinition[];
  actions: ActionDefinition[];
  pipeline: PipelineDefinition;
}

// action FetchInvoiceList { ... }
export interface ActionDefinition {
  type: 'ActionDefinition';
  name: string;
  steps: ActionStep[];
}

export type ActionStep =
  | FetchStep
  | ForStep
  | MapStep
  | ValidateStep
  | StoreStep
  | MatchStep
  | LetStep
  | GenerateStep
  | ApplyStep
  | WebhookStep
  | PauseStep;

// let myVar = expression
export interface LetStep {
  type: 'LetStep';
  name: string;
  value: Expression;
}

// generate 100 of Customer as customers { seed: 42 }
export interface GenerateStep {
  type: 'GenerateStep';
  count: number;
  schema: string;
  as: string;
  seed?: number;
}

// wait { timeout: 60000, path: "/webhooks/callback", ... }
// Waits for an external webhook callback before continuing execution
export interface WebhookStep {
  type: 'WebhookStep';
  /** Timeout in milliseconds to wait for webhook (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Path for the webhook endpoint (e.g., "/webhooks/callback") */
  path?: string;
  /** Number of webhook events to collect before continuing (default: 1) */
  expectedEvents?: number;
  /** Filter expression for matching webhook events */
  eventFilter?: Expression;
  /** Retry configuration if timeout occurs */
  retryOnTimeout?: RetryConfig;
  /** Store configuration for saving webhook payloads */
  storage?: WebhookStorageConfig;
}

export interface WebhookStorageConfig {
  /** Store name to save webhook payloads */
  target: string;
  /** Expression for extracting key from webhook payload */
  key?: Expression;
}

// pause { duration: "7d", persist: FileStore, resume-on: webhook "/approved" | timeout }
// Resource-free long pause that persists state and releases resources
export interface PauseStep {
  type: 'PauseStep';
  /** Duration to pause (e.g., "7d", "1h", "30m", 86400000) */
  duration: string | number;
  /** Store to persist pause state (defaults to FileStore) */
  persist?: string;
  /** Resume triggers - timeout (default) and/or webhook */
  resumeOn?: PauseResumeTrigger[];
}

export type PauseResumeTrigger =
  { type: 'timeout' } | { type: 'webhook'; path: string; eventFilter?: Expression };

// Flow control directives for match arms
export type FlowDirective =
  | { type: 'continue' } // proceed to next pipeline stage
  | { type: 'skip' } // skip remaining steps, move to next stage
  | { type: 'abort'; message?: string } // halt mission with error
  | { type: 'retry'; backoff?: RetryConfig } // retry current action
  | { type: 'queue'; target?: string } // queue for later processing
  | { type: 'jump'; action: string; then?: 'retry' | 'continue' }; // jump to action

// match response { Schema1 -> steps..., Schema2 -> flow directive }
export interface MatchStep {
  type: 'MatchStep';
  target: Expression; // what to match (usually 'response')
  arms: MatchArm[];
}

export interface MatchArm {
  /** Schema name to match against, or '_' for wildcard */
  schema: string;
  /**
   * HTTP status to match against the last response's status, written as the
   * bare number (`404 -> skip`). Deliberately the same vocabulary as the
   * fetch's `allow` list, so there is no schema name to invent and keep in sync.
   */
  status?: number;
  /**
   * When true the arm was written as `[Schema]` and matches only when the value
   * is an array whose every element satisfies `schema`.
   */
  isArray?: boolean;
  /** Optional guard condition (when using 'where' clause) */
  guard?: Expression;
  /** Steps to execute if matched */
  steps?: ActionStep[];
  /** Flow control directive (if no steps) */
  flow?: FlowDirective;
}

// get "/Invoices" { paginate: ..., until: ... }
// call Xero.getInvoices { paginate: ... }  -- OAS operationId reference
// get "/Invoices" { since: lastSync }  -- Incremental sync
export interface FetchStep {
  type: 'FetchStep';
  // Traditional: explicit method + path
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: Expression; // Can contain interpolations like "/Invoices/{id}"
  // OAS-based: source.operationId reference
  operationRef?: OperationRef;
  source?: string; // Which source to use (defaults to first defined)
  body?: Expression;
  headers?: Record<string, Expression>;
  paginate?: PaginationConfig;
  until?: Expression; // Condition to stop pagination
  retry?: RetryConfig;
  /**
   * Response statuses to treat as data rather than failure. An allowed status
   * returns normally - it is not retried and does not trip the circuit breaker
   * - so a `match` arm can dispatch on the same number that allowed it.
   */
  allow?: number[];
  // Incremental sync
  since?: SinceConfig;
  /**
   * Resumable backfill: persist per-page progress to the execution log so a
   * large paginated fetch survives a restart/deploy and continues from the last
   * page. Requires durable mode (an executionLog). Only meaningful with paginate.
   */
  backfill?: boolean;
}

// Configuration for incremental sync
export interface SinceConfig {
  /** How to resolve the "since" timestamp */
  type: 'lastSync' | 'expression';
  /** Custom checkpoint key (defaults to source:endpoint) */
  key?: string;
  /** Query parameter name for the since value (default: 'since') */
  param?: string;
  /** Header name for the since value (e.g., 'If-Modified-Since'). Mutually exclusive with param. */
  header?: string;
  /** Date format for the since value */
  format?: 'iso' | 'unix' | 'unix-ms' | 'date-only';
  /** Expression to evaluate for 'expression' type */
  expression?: Expression;
  /** Field in response to use as the new "since" value for next sync */
  updateFrom?: string;
}

export interface OperationRef {
  source: string; // Source name (e.g., "Xero")
  operationId: string; // OAS operationId (e.g., "getInvoices")
}

export interface PaginationConfig {
  type: 'offset' | 'cursor' | 'page';
  param: string; // Query param name: "page", "offset", "cursor"
  pageSize: number;
  cursorPath?: string; // For cursor pagination: where to find next cursor in response
  /**
   * Dotted path to the array holding the records in each response (e.g. "data"
   * or "result.items"). When omitted the runtime falls back to picking the first
   * array-valued key, which guesses wrong on `{warnings: [], data: [...]}`
   * envelopes - declare this whenever the response wraps its records.
   */
  itemsPath?: string;
  /**
   * Cap on pages fetched in one run before pagination stops as *truncated*
   * (memory/runaway safety). Overrides the runtime default. When this cap fires
   * the result is flagged truncated so a sync checkpoint will not advance past
   * the records that were never fetched.
   */
  maxPages?: number;
  /** Cap on total items accumulated in one run before stopping as truncated. */
  maxItems?: number;
}

export interface RetryConfig {
  maxAttempts: number;
  backoff: 'exponential' | 'linear' | 'constant';
  initialDelay: number; // ms
  maxDelay?: number; // ms
  /** Per-attempt request timeout in ms; aborts a request that hangs */
  timeout?: number;
}

// for invoice in invoices_cache where .partial == true { ... }
export interface ForStep {
  type: 'ForStep';
  variable: string;
  collection: Expression;
  condition?: Expression; // where clause
  steps: ActionStep[];
  /**
   * Max iterations in flight. Absent (the default) runs strictly sequentially.
   * Iterations already get their own child context, so the loop variable and
   * `response` stay isolated; stores are shared, so concurrent iterations
   * writing the same key are last-writer-wins.
   */
  concurrency?: number;
  /**
   * What a failing iteration does to the rest of the loop. Defaults to
   * `continue`: a bulk fan-out is mostly items that can fail on their own
   * terms (an id that no longer exists, a socket reset, one 500 that outlived
   * its retries), and stopping the run for any of them makes large jobs
   * impossible to finish. `abort` restores strict fail-fast.
   */
  onError?: LoopErrorPolicy;
}

export interface LoopErrorPolicy {
  action: 'continue' | 'abort';
  /** Store to record each failed item in, for a later sweep. */
  queue?: string;
}

// map invoice -> StandardInvoice { id: .InvoiceID, ... }
export interface MapStep {
  type: 'MapStep';
  source: Expression;
  targetSchema: string;
  mappings: FieldMapping[];
}

export interface FieldMapping {
  field: string;
  expression: Expression;
}

// Named, reusable transformation with optional overloading
// transform ToStandard: RawItem -> StandardItem { ... }
// transform ToUnified { (SchemaA) -> Target { ... }, (SchemaB) -> Target { ... } }
export interface TransformDefinition {
  type: 'TransformDefinition';
  name: string;
  variants: TransformVariant[];
}

export interface TransformVariant {
  /** Source schema name, or '_' for wildcard/default */
  sourceSchema: string | '_';
  /** Target schema name */
  targetSchema: string;
  /** Optional guard condition for additional matching */
  guard?: Expression;
  /** Field mappings for this variant */
  mappings: FieldMapping[];
}

// apply TransformName to expression
// apply TransformName to expression as variableName
export interface ApplyStep {
  type: 'ApplyStep';
  transform: string;
  source: Expression;
  /** Optional: bind result to a variable instead of response */
  as?: string;
}

// try { expr1, expr2, expr3 } - field-level fallback chain
export interface TryExpression {
  type: 'TryExpression';
  expressions: Expression[];
}

// validate response { assume .Total is decimal, ... }
// validate order { assume payment_exists == true } or { store ... }
export interface ValidateStep {
  type: 'ValidateStep';
  target: Expression;
  /** Optional named Vague schema to validate before inline assumptions. */
  schema?: string;
  constraints: ValidationConstraint[];
  /**
   * Optional `or { ... }` fallback: steps to run when a constraint fails,
   * instead of throwing a ValidationError. Lets a pipeline record a discrepancy
   * and carry on rather than aborting the mission.
   */
  fallback?: ActionStep[];
}

export interface ValidationConstraint {
  type: 'ValidationConstraint';
  condition: Expression;
  message?: string;
  severity: 'error' | 'warning';
}

// store response -> invoices_cache { key: .InvoiceID, partial: false }
export interface StoreStep {
  type: 'StoreStep';
  source: Expression;
  target: string; // store name
  options: StoreOptions;
}

export interface StoreOptions {
  key?: Expression; // Primary key field
  partial?: boolean; // Mark as partial entity
  upsert?: boolean; // Update if exists
}

// run FetchInvoiceList then HydrateInvoices then NormalizeInvoices
// run [FetchOrders, FetchPayments] then ReconcileData  -- parallel stages
export interface PipelineDefinition {
  type: 'PipelineDefinition';
  stages: PipelineStage[];
}

export interface PipelineStage {
  /** Single action name (for sequential stages) */
  action?: string;
  /** Multiple action names (for parallel stages with bracket syntax) */
  actions?: string[];
  /** Optional: only run if condition true */
  condition?: Expression;
}

/** Helper to check if a stage is parallel */
export function isParallelStage(
  stage: PipelineStage
): stage is PipelineStage & { actions: string[] } {
  return Array.isArray(stage.actions) && stage.actions.length > 0;
}

/** Helper to get action names from a stage (works for both single and parallel) */
export function getStageActions(stage: PipelineStage): string[] {
  if (stage.actions) return stage.actions;
  if (stage.action) return [stage.action];
  return [];
}

// Re-export Vague types for convenience (FieldDefinition used by schema definitions)
export type { Expression, FieldDefinition, SchemaDefinition } from 'vague-lang';
