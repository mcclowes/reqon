export { ReqonLexer, ReqonTokenType, type ReqonToken } from './lexer/index.js';
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

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ReqonLexer } from './lexer/index.js';
import { ReqonParser } from './parser/index.js';
import { MissionExecutor, type ExecutorConfig } from './interpreter/index.js';
import type { ReqonProgram } from './ast/index.js';

export function parse(source: string): ReqonProgram {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens);
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
  return execute(source, config);
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
