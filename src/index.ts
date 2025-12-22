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
} from './execution/index.js';
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
  type CreateLoggerOptions,
  // OpenTelemetry
  SpanBuilder,
  OTelEventAdapter,
  OTLPExporter,
  createOTelListener,
  type OTelSpan,
  type OTLPExporterConfig,
} from './observability/index.js';
export { MCP_SERVER_VERSION } from './mcp/index.js';

// AI Documentation Review
export {
  DocumentationAnalyzer,
  AnthropicClient,
  VagueDocFetcher,
  ReviewReporter,
  fetchReqonContext,
  type AIReviewConfig,
  type VagueDocumentation,
  type ReqonContext,
  type ReviewResult,
  type ReviewReport,
  type ReviewFinding,
  type SuggestedAction,
} from './ai-review/index.js';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ReqonLexer } from './lexer/index.js';
import { ReqonParser } from './parser/index.js';
import { MissionExecutor, type ExecutorConfig } from './interpreter/index.js';
import { loadMission } from './loader/index.js';
import type { ReqonProgram } from './ast/index.js';

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
  const { program } = await loadMission(path);
  const executor = new MissionExecutor(config);
  return executor.execute(program);
}

// Tagged template literal for inline missions
export function reqon(
  strings: TemplateStringsArray,
  ...values: unknown[]
): ReqonProgram {
  let source = strings[0];
  for (let i = 0; i < values.length; i++) {
    source += String(values[i]) + strings[i + 1];
  }
  return parse(source);
}
