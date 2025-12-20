import type {
  Expression,
  FieldDefinition,
  SchemaDefinition,
  Statement as VagueStatement,
} from 'vague-lang';

// Reqon extends Vague's statements
export type Statement = VagueStatement | MissionDefinition | SourceDefinition | StoreDefinition;

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
}

export interface RateLimitSourceConfig {
  strategy?: 'pause' | 'throttle' | 'fail'; // Default: 'pause'
  maxWait?: number; // Max seconds to wait (default: 300)
  fallbackRpm?: number; // Fallback requests per minute if no headers
}

export interface AuthConfig {
  type: 'oauth2' | 'bearer' | 'basic' | 'api_key' | 'none';
  // Details resolved at runtime from environment/config
}

// store invoices_cache: nosql("invoices")
// store invoices_sql: sql("accounting.invoices")
export interface StoreDefinition {
  type: 'StoreDefinition';
  name: string;
  storeType: 'nosql' | 'sql' | 'memory';
  target: string; // collection/table name
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

// mission SyncXeroInvoices { ... }
export interface MissionDefinition {
  type: 'MissionDefinition';
  name: string;
  schedule?: ScheduleDefinition;
  sources: SourceDefinition[];
  stores: StoreDefinition[];
  schemas: SchemaDefinition[];
  actions: ActionDefinition[];
  pipeline: PipelineDefinition;
}

// action FetchInvoiceList { ... }
export interface ActionDefinition {
  type: 'ActionDefinition';
  name: string;
  steps: ActionStep[];
}

export type ActionStep = FetchStep | ForStep | MapStep | ValidateStep | StoreStep;

// fetch GET "/Invoices" { paginate: ..., until: ... }
// fetch Xero.getInvoices { paginate: ... }  -- OAS operationId reference
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
}

export interface RetryConfig {
  maxAttempts: number;
  backoff: 'exponential' | 'linear' | 'constant';
  initialDelay: number; // ms
  maxDelay?: number; // ms
}

// for invoice in invoices_cache where .partial == true { ... }
export interface ForStep {
  type: 'ForStep';
  variable: string;
  collection: Expression;
  condition?: Expression; // where clause
  steps: ActionStep[];
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

// validate response { assume .Total is decimal, ... }
export interface ValidateStep {
  type: 'ValidateStep';
  target: Expression;
  constraints: ValidationConstraint[];
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
export interface PipelineDefinition {
  type: 'PipelineDefinition';
  stages: PipelineStage[];
}

export interface PipelineStage {
  action: string;
  condition?: Expression; // Optional: only run if condition true
  parallel?: boolean; // Run in parallel with previous stage
}

// Re-export Vague types for convenience
export type { Expression, FieldDefinition, SchemaDefinition } from 'vague-lang';
