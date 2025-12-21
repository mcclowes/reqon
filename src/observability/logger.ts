/**
 * Structured Logger - Enhanced logging with context and spans
 *
 * Provides structured logging capabilities with:
 * - Hierarchical context (child loggers)
 * - Timing spans for operations
 * - Multiple output formats
 * - Integration with event emitter
 */

import type { LogLevel, EventEmitter, EventType } from './events.js';

/** Log entry structure */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: Record<string, unknown>;
  spanId?: string;
  parentSpanId?: string;
  duration?: number;
}

/** Span for timing operations */
export interface Span {
  /** End the span and return duration in ms */
  end(): number;
  /** Add context to the span */
  addContext(context: Record<string, unknown>): void;
  /** Create a child span */
  child(name: string): Span;
  /** Get span ID */
  readonly id: string;
}

/** Output handler interface */
export interface LogOutput {
  write(entry: LogEntry): void;
}

/** Structured logger interface */
export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;

  /** Create a child logger with additional context */
  child(context: Record<string, unknown>): StructuredLogger;

  /** Create a timing span */
  span(name: string): Span;

  /** Set minimum log level */
  setLevel(level: LogLevel): void;

  /** Add an output handler */
  addOutput(output: LogOutput): void;
}

// ============================================================================
// Span Implementation
// ============================================================================

class SpanImpl implements Span {
  readonly id: string;
  private name: string;
  private startTime: number;
  private context: Record<string, unknown> = {};
  private parentSpanId?: string;
  private logger: StructuredLoggerImpl;
  private ended = false;

  constructor(name: string, logger: StructuredLoggerImpl, parentSpanId?: string) {
    this.id = generateSpanId();
    this.name = name;
    this.startTime = Date.now();
    this.parentSpanId = parentSpanId;
    this.logger = logger;
  }

  end(): number {
    if (this.ended) return 0;
    this.ended = true;

    const duration = Date.now() - this.startTime;
    this.logger.writeSpanEnd(this.name, this.id, this.parentSpanId, duration, this.context);
    return duration;
  }

  addContext(context: Record<string, unknown>): void {
    Object.assign(this.context, context);
  }

  child(name: string): Span {
    return new SpanImpl(name, this.logger, this.id);
  }
}

function generateSpanId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// ============================================================================
// Logger Implementation
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class StructuredLoggerImpl implements StructuredLogger {
  private context: Record<string, unknown>;
  private outputs: LogOutput[] = [];
  private minLevel: LogLevel = 'info';
  private eventEmitter?: EventEmitter;

  constructor(
    context: Record<string, unknown> = {},
    outputs: LogOutput[] = [],
    minLevel: LogLevel = 'info',
    eventEmitter?: EventEmitter
  ) {
    this.context = context;
    this.outputs = outputs;
    this.minLevel = minLevel;
    this.eventEmitter = eventEmitter;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.context, ...context },
    };

    for (const output of this.outputs) {
      try {
        output.write(entry);
      } catch {
        // Swallow output errors
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  child(context: Record<string, unknown>): StructuredLogger {
    return new StructuredLoggerImpl(
      { ...this.context, ...context },
      this.outputs,
      this.minLevel,
      this.eventEmitter
    );
  }

  span(name: string): Span {
    const span = new SpanImpl(name, this);
    this.debug(`span:start`, { spanName: name, spanId: span.id });
    return span;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  addOutput(output: LogOutput): void {
    this.outputs.push(output);
  }

  /** Internal: write span end entry */
  writeSpanEnd(
    name: string,
    spanId: string,
    parentSpanId: string | undefined,
    duration: number,
    spanContext: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      level: 'debug',
      message: `span:end`,
      timestamp: new Date().toISOString(),
      context: { ...this.context, spanName: name, ...spanContext },
      spanId,
      parentSpanId,
      duration,
    };

    for (const output of this.outputs) {
      try {
        output.write(entry);
      } catch {
        // Swallow output errors
      }
    }
  }

  /** Get the event emitter if configured */
  getEventEmitter(): EventEmitter | undefined {
    return this.eventEmitter;
  }

  /** Emit an event (convenience method) */
  emit<T>(type: EventType, payload: T): void {
    this.eventEmitter?.emit(type, payload);
  }
}

// ============================================================================
// Output Handlers
// ============================================================================

/** Console output with human-readable formatting */
export class ConsoleOutput implements LogOutput {
  private prefix: string;
  private colors: boolean;

  constructor(options: { prefix?: string; colors?: boolean } = {}) {
    this.prefix = options.prefix ?? 'Reqon';
    this.colors = options.colors ?? true;
  }

  write(entry: LogEntry): void {
    const prefix = `[${this.prefix}]`;
    const levelStr = entry.level.toUpperCase().padEnd(5);

    // Format context as key=value pairs
    const contextStr = Object.keys(entry.context).length > 0
      ? ` ${formatContext(entry.context)}`
      : '';

    // Format duration if present
    const durationStr = entry.duration !== undefined
      ? ` (${entry.duration}ms)`
      : '';

    const message = `${prefix} ${levelStr} ${entry.message}${contextStr}${durationStr}`;

    switch (entry.level) {
      case 'debug':
        console.debug(message);
        break;
      case 'info':
        console.log(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      case 'error':
        console.error(message);
        break;
    }
  }
}

/** JSON Lines output for log aggregation */
export class JsonLinesOutput implements LogOutput {
  private stream: { write: (line: string) => void };

  constructor(stream?: { write: (line: string) => void }) {
    this.stream = stream ?? { write: (line) => console.log(line) };
  }

  write(entry: LogEntry): void {
    const json = JSON.stringify({
      ...entry,
      '@timestamp': entry.timestamp,
    });
    this.stream.write(json);
  }
}

/** Buffer output for testing */
export class BufferOutput implements LogOutput {
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }

  find(predicate: (entry: LogEntry) => boolean): LogEntry | undefined {
    return this.entries.find(predicate);
  }

  filter(predicate: (entry: LogEntry) => boolean): LogEntry[] {
    return this.entries.filter(predicate);
  }
}

/** Event emitter output - bridges logs to events */
export class EventOutput implements LogOutput {
  private emitter: EventEmitter;

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  write(entry: LogEntry): void {
    // Map log entries to appropriate event types based on context
    // This allows logs to flow into the event system
    if (entry.context.eventType) {
      this.emitter.emit(
        entry.context.eventType as EventType,
        { ...entry.context, message: entry.message }
      );
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export interface CreateLoggerOptions {
  /** Logger prefix for console output */
  prefix?: string;
  /** Minimum log level */
  level?: LogLevel;
  /** Include console output */
  console?: boolean;
  /** Include JSON lines output */
  jsonLines?: boolean;
  /** Custom JSON lines stream */
  jsonStream?: { write: (line: string) => void };
  /** Event emitter for bridging */
  eventEmitter?: EventEmitter;
  /** Initial context */
  context?: Record<string, unknown>;
  /** Silent mode (no outputs) */
  silent?: boolean;
}

/**
 * Create a structured logger with configured outputs
 */
export function createStructuredLogger(options: CreateLoggerOptions = {}): StructuredLogger {
  const outputs: LogOutput[] = [];

  if (!options.silent) {
    if (options.console !== false) {
      outputs.push(new ConsoleOutput({ prefix: options.prefix }));
    }

    if (options.jsonLines) {
      outputs.push(new JsonLinesOutput(options.jsonStream));
    }

    if (options.eventEmitter) {
      outputs.push(new EventOutput(options.eventEmitter));
    }
  }

  return new StructuredLoggerImpl(
    options.context ?? {},
    outputs,
    options.level ?? 'info',
    options.eventEmitter
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatContext(context: Record<string, unknown>): string {
  return Object.entries(context)
    .filter(([key]) => !key.startsWith('_')) // Skip internal keys
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}="${value}"`;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return `${key}=${value}`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(' ');
}
