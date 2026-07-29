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
  FetchHeartbeatPayload,
  DataTransformPayload,
  DataValidatePayload,
  DataStorePayload,
  LoopStartPayload,
  LoopIterationPayload,
  LoopCompletePayload,
  LoopHeartbeatPayload,
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
  ConsoleTimeMode,
} from './logger.js';

export {
  ConsoleOutput,
  JsonLinesOutput,
  BufferOutput,
  EventOutput,
  createStructuredLogger,
} from './logger.js';

// Progress reporting
export type { ProgressSnapshot, ProgressReporterOptions } from './progress.js';

export { ProgressReporter, formatProgressLine, formatCount, formatDuration } from './progress.js';

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
