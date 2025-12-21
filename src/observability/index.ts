/**
 * Observability Module - Mission execution monitoring
 *
 * Provides comprehensive observability for Reqon missions:
 * - Structured event system
 * - Enhanced logging with context
 * - OpenTelemetry integration
 * - Multiple output adapters
 */

// Events
export type {
  LogLevel,
  ObservabilityEvent,
  EventType,
  EventHandler,
  EventEmitter,
  // Payload types
  MissionStartPayload,
  MissionCompletePayload,
  MissionFailedPayload,
  StageStartPayload,
  StageCompletePayload,
  StepType,
  StepStartPayload,
  StepCompletePayload,
  FetchStartPayload,
  FetchCompletePayload,
  FetchRetryPayload,
  FetchErrorPayload,
  DataTransformPayload,
  DataValidatePayload,
  DataStorePayload,
  LoopStartPayload,
  LoopIterationPayload,
  LoopCompletePayload,
  MatchAttemptPayload,
  MatchResultPayload,
  WebhookRegisterPayload,
  WebhookEventPayload,
  WebhookCompletePayload,
  CheckpointSavePayload,
  CheckpointResumePayload,
  SyncCheckpointPayload,
  RateLimitPayload,
  CircuitBreakerPayload,
} from './events.js';

export { ObservabilityEmitter, createEmitter } from './events.js';

// Logger
export type {
  LogEntry,
  Span,
  LogOutput,
  StructuredLogger,
  CreateLoggerOptions,
} from './logger.js';

export {
  ConsoleOutput,
  JsonLinesOutput,
  BufferOutput,
  EventOutput,
  createStructuredLogger,
} from './logger.js';

// OpenTelemetry
export type {
  OTelSpan,
  OTelAttribute,
  OTelSpanEvent,
  TraceContext,
  OTLPExporterConfig,
} from './otel.js';

export {
  generateTraceId,
  generateSpanId,
  SpanBuilder,
  OTelEventAdapter,
  OTLPExporter,
  OTelLogOutput,
  createOTelListener,
} from './otel.js';
