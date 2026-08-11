/**
 * ---
 * purpose: Main library entry point - exports all public APIs
 * exports:
 *   - parse, execute, fromFile, fromPath, reqon - convenience functions
 *   - ReqonLexer, ReqonParser - parsing infrastructure
 *   - MissionExecutor - runtime execution
 *   - Store adapters, Scheduler, Sync, Webhook, Observability
 * related:
 *   - ./cli.ts - CLI entry point using these exports
 *   - ./plugin.ts - Vague plugin registration
 *   - ./interpreter/executor.ts - core execution logic
 * ---
 */

export { ReqonLexer, ReqonTokenType, type ReqonToken } from './lexer/index.js';
export { reqonPlugin, registerReqonPlugin } from './plugin.js';
export { ReqonParser } from './parser/index.js';
export * from './ast/index.js';
export {
  MissionExecutor,
  HttpClient,
  BearerAuthProvider,
  OAuth2AuthProvider,
  createContext,
  evaluate,
  type ExecutionResult,
  type ExecutionError,
  type ExecutorConfig,
  type AuthConfig,
  type ExecutionContext,
  type ProgressCallbacks,
  type ExecutionStartEvent,
  type ExecutionCompleteEvent,
  type StageStartEvent,
  type StageCompleteEvent,
} from './interpreter/index.js';
export {
  MemoryStore,
  FileStore,
  createStore,
  type StoreAdapter,
  type StoreFilter,
  type StoreConfig,
} from './stores/index.js';
export {
  createExecutionState,
  findResumePoint,
  canResume,
  getProgress,
  getExecutionSummary,
  FileExecutionStore,
  MemoryExecutionStore,
  type ExecutionState,
  type ExecutionStore,
  type StageState,
  type LiveProgress,
} from './execution/index.js';
export {
  MemoryExecutionLog,
  FileExecutionLog,
  SqliteExecutionLog,
  PostgresExecutionLog,
  foldLog,
  loadState,
  effectId,
  reduceCheckpoints,
  type ExecutionEvent,
  type StoredEvent,
  type ExecutionLogStore,
  type CheckpointRecord,
  type FoldedState,
} from './execution-log/index.js';
export {
  Scheduler,
  parseCronExpression,
  getNextRunTime,
  intervalToMs,
  shouldRunNow,
  type ScheduledJob,
  type SchedulerState,
  type ScheduleEvent,
  type SchedulerCallbacks,
  type SchedulerConfig,
  type ScheduledMission,
} from './scheduler/index.js';
export {
  generateCheckpointKey,
  formatSinceDate,
  parseSinceDate,
  EPOCH,
  FileSyncStore,
  MemorySyncStore,
  LogBackedSyncStore,
  type SyncCheckpoint,
  type SyncStore,
} from './sync/index.js';
export {
  ReqonError,
  ParseError,
  LexerError,
  RuntimeError,
  ValidationError,
  formatErrors,
  getSourceLine,
  getSourceContext,
  type SourceLocation,
  type ErrorContext,
} from './errors/index.js';
export {
  loadMission,
  isMissionFolder,
  getMissionName,
  type LoadResult,
  type LoadOptions,
} from './loader/index.js';

// OpenAPI spec integration. `ValidationError` is aliased because the errors
// module already exports a class of that name.
export {
  loadOAS,
  resolveOperation,
  getResponseSchema,
  validateResponse,
  generateMockData,
  type OASSource,
  type OASOperation,
  type OpenAPISpec,
  type ValidationResult,
  type ValidationError as OASValidationError,
  type MockGeneratorOptions,
} from './oas/index.js';
export {
  loadEnv,
  loadCredentials,
  resolveCredentials,
  resolveEnvString,
  hasEnvReference,
  credentialsFromEnv,
  type CredentialsConfig,
  type LoadEnvResult,
  type AuthCredentials,
  type SourceCredentials,
} from './auth/credentials.js';
export {
  WebhookServer,
  MemoryWebhookStore,
  FileWebhookStore,
  type WebhookStore,
  type WebhookServerConfig,
  type WebhookServerCallbacks,
  type WebhookRegistration,
  type WebhookEvent,
  type WaitResult,
} from './webhook/index.js';

// Control server for pause/resume and status queries
export {
  ControlServer,
  type ControlServerConfig,
  type ControlServerCallbacks,
  type StatusResponse,
  type ControlResponse,
} from './control/index.js';

// Observability
export {
  // Event system
  ObservabilityEmitter,
  createEmitter,
  type ObservabilityEvent,
  type EventType,
  type EventHandler,
  type EventEmitter,
  // Payload types
  type MissionStartPayload,
  type MissionCompletePayload,
  type StageStartPayload,
  type StageCompletePayload,
  type StepStartPayload,
  type StepCompletePayload,
  type FetchStartPayload,
  type FetchCompletePayload,
  type DataStorePayload,
  type LoopStartPayload,
  type LoopCompletePayload,
  type WebhookRegisterPayload,
  type WebhookCompletePayload,
  // Logger
  createStructuredLogger,
  ConsoleOutput,
  JsonLinesOutput,
  BufferOutput,
  type StructuredLogger,
  type LogEntry,
  type LogOutput,
  type Span,
  type LogLevel,
  type CreateLoggerOptions,
  type ConsoleTimeMode,
  // Progress reporting
  ProgressReporter,
  formatProgressLine,
  type ProgressSnapshot,
  type ProgressReporterOptions,
  // OpenTelemetry
  SpanBuilder,
  OTelEventAdapter,
  OTLPExporter,
  createOTelListener,
  type OTelSpan,
  type OTLPExporterConfig,
} from './observability/index.js';
export { MCP_SERVER_VERSION } from './mcp/index.js';

// Debug
export {
  BaseDebugController,
  CLIDebugger,
  type DebugController,
  type DebugMode,
  type DebugPauseReason,
  type DebugSnapshot,
  type DebugCommand,
  type DebugLocation,
} from './debug/index.js';

// Trace - time-travel debugging
export {
  FileTraceStore,
  MemoryTraceStore,
  TraceRecorder,
  TraceReplayer,
  LogTraceView,
  traceTimelineFromLog,
  createTraceRecorder,
  createTraceReplayer,
  createExecutionTrace,
  safeClone,
  truncateForTrace,
  type LogTimelineEntry,
  type LogTraceSummary,
  type TraceStore,
  type TraceSnapshot,
  type StoreSnapshot as TraceStoreSnapshot,
  type LoopContext as TraceLoopContext,
  type ExecutionTrace,
  type TraceRecorderConfig,
  type ReplaySession,
  type ReplayStepResult,
  type TimelineEvent,
  type VariableChange,
  type SnapshotDiff,
} from './trace/index.js';

// Pause - resource-free long pauses
export {
  FilePauseStore,
  MemoryPauseStore,
  LogBackedPauseStore,
  PauseManager,
  createPauseManager,
  PauseOrchestrator,
  createPauseOrchestrator,
  parseDuration,
  formatDuration,
  createPauseState,
  isPauseExpired,
  getRemainingTime,
  getPauseSummary,
  type PauseStore,
  type PauseState,
  type PauseCheckpoint,
  type PauseResumeTriggerState,
  type PauseManagerConfig,
  type CreatePauseOptions,
  type PauseStatus,
  type PauseOrchestratorConfig,
} from './pause/index.js';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ReqonLexer } from './lexer/index.js';
import { ReqonParser } from './parser/index.js';
import { MissionExecutor, type ExecutorConfig } from './interpreter/index.js';
import { loadMission } from './loader/index.js';
import type { ReqonProgram } from './ast/index.js';
import { PauseOrchestrator, LogBackedPauseStore } from './pause/index.js';
import type { PauseState } from './pause/index.js';

export function parse(source: string, filePath?: string): ReqonProgram {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens, source, filePath);
  return parser.parse();
}

export async function execute(
  source: string,
  config: ExecutorConfig = {}
): Promise<import('./interpreter/index.js').ExecutionResult> {
  const program = parse(source);
  const executor = new MissionExecutor(config);
  return executor.execute(program);
}

export async function fromFile(
  filePath: string,
  config: ExecutorConfig = {}
): Promise<import('./interpreter/index.js').ExecutionResult> {
  const absolutePath = resolve(filePath);
  const source = await readFile(absolutePath, 'utf-8');
  const program = parse(source, absolutePath);
  const executor = new MissionExecutor(config);
  return executor.execute(program);
}

/**
 * Load and execute a mission from a file or folder.
 *
 * Supports both:
 * - Single file: ./sync-invoices.reqon
 * - Folder: ./sync-invoices/ (with mission.reqon + action files)
 */
export async function fromPath(
  path: string,
  config: ExecutorConfig = {}
): Promise<import('./interpreter/index.js').ExecutionResult> {
  const { program, baseDir } = await loadMission(path);
  const executor = new MissionExecutor({ ...config, missionDir: baseDir });
  return executor.execute(program);
}

export interface ExecuteWithResumeOptions {
  /** Poll interval for the pause timeout monitor in ms (default: 1 minute). */
  pollInterval?: number;
  /** Safety cap on resume cycles before giving up (default: 1000). */
  maxResumes?: number;
}

/**
 * Execute a mission and automatically resume it when a pause's trigger fires.
 *
 * Runs the mission; when it suspends on a `pause` step, stays live until an
 * inbound webhook on the pause's path or its expired timeout resumes it, then
 * re-executes with `resumeFrom` so the replay continues past the pause. Loops
 * until the run finishes (or fails), so a mission with several pauses completes
 * end to end in one call.
 *
 * Requires `config.executionLog`: replaying past a pause needs the durable
 * event log. Webhook triggers additionally need `config.webhookServer`
 * (started by the caller).
 */
export async function executeWithResume(
  source: string,
  config: ExecutorConfig,
  options: ExecuteWithResumeOptions = {}
): Promise<import('./interpreter/index.js').ExecutionResult> {
  const executionLog = config.executionLog;
  if (!executionLog) {
    throw new Error(
      'executeWithResume requires config.executionLog: resuming past a pause replays the durable event log'
    );
  }
  const program = parse(source);
  const maxResumes = options.maxResumes ?? 1000;

  // Resumed pauses queue here; the loop below is the only consumer. Dispatching
  // through a queue (instead of executing inside the orchestrator callback)
  // serializes runs — a webhook that lands while the paused run is still
  // unwinding must not start the resume run concurrently with it.
  const pending: PauseState[] = [];
  let wake: (() => void) | undefined;
  const logger = config.logger;
  const orchestrator = new PauseOrchestrator({
    store: new LogBackedPauseStore(executionLog),
    webhookServer: config.webhookServer,
    pollInterval: options.pollInterval,
    resume: (pause) => {
      pending.push(pause);
      wake?.();
    },
    log: logger ? (msg) => logger.info(msg) : undefined,
  });

  const nextResume = async (executionId: string): Promise<PauseState> => {
    for (;;) {
      const index = pending.findIndex((p) => p.executionId === executionId);
      if (index !== -1) return pending.splice(index, 1)[0];
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  };

  await orchestrator.start();
  try {
    let result = await new MissionExecutor(config).execute(program);

    for (let cycles = 0; result.pauseId; cycles++) {
      if (cycles >= maxResumes) {
        throw new Error(
          `executeWithResume exceeded ${maxResumes} resume cycles for execution ${result.executionId}`
        );
      }
      const executionId = result.executionId;
      if (!executionId) break;
      await nextResume(executionId);
      result = await new MissionExecutor({ ...config, resumeFrom: executionId }).execute(program);
    }

    return result;
  } finally {
    orchestrator.stop();
  }
}

// Tagged template literal for inline missions
export function reqon(strings: TemplateStringsArray, ...values: unknown[]): ReqonProgram {
  let source = strings[0];
  for (let i = 0; i < values.length; i++) {
    source += String(values[i]) + strings[i + 1];
  }
  return parse(source);
}
