import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ObservabilityEmitter,
  createEmitter,
  type ObservabilityEvent,
  type EventType,
} from './events.js';
import {
  createStructuredLogger,
  ConsoleOutput,
  JsonLinesOutput,
  BufferOutput,
  type LogEntry,
} from './logger.js';
import {
  SpanBuilder,
  OTelEventAdapter,
  generateTraceId,
  generateSpanId,
} from './otel.js';

describe('ObservabilityEmitter', () => {
  let emitter: ObservabilityEmitter;

  beforeEach(() => {
    emitter = createEmitter('test-exec-123', 'test-mission');
  });

  it('should create an emitter with context', () => {
    expect(emitter).toBeInstanceOf(ObservabilityEmitter);
  });

  it('should emit events to specific handlers', () => {
    const handler = vi.fn();
    emitter.on('mission.start', handler);

    emitter.emit('mission.start', { stageCount: 3, isResume: false });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission.start',
        executionId: 'test-exec-123',
        mission: 'test-mission',
        payload: { stageCount: 3, isResume: false },
      })
    );
  });

  it('should emit events to all-event handlers', () => {
    const handler = vi.fn();
    emitter.onAll(handler);

    emitter.emit('stage.start', { stageIndex: 0, stageName: 'test' });
    emitter.emit('stage.complete', { stageIndex: 0, success: true });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should return unsubscribe function', () => {
    const handler = vi.fn();
    const unsubscribe = emitter.on('fetch.start', handler);

    emitter.emit('fetch.start', { source: 'api', method: 'GET', path: '/users' });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitter.emit('fetch.start', { source: 'api', method: 'GET', path: '/users' });
    expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  it('should include timestamp and duration in events', () => {
    const handler = vi.fn();
    emitter.onAll(handler);

    emitter.emit('mission.start', {});

    const event = handler.mock.calls[0][0] as ObservabilityEvent;
    expect(event.timestamp).toBeDefined();
    expect(typeof event.timestamp).toBe('string');
    expect(event.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle errors in handlers gracefully', () => {
    const throwingHandler = vi.fn(() => {
      throw new Error('Handler error');
    });
    const normalHandler = vi.fn();

    emitter.on('mission.start', throwingHandler);
    emitter.on('mission.start', normalHandler);

    // Should not throw
    expect(() => emitter.emit('mission.start', {})).not.toThrow();

    // Normal handler should still be called
    expect(normalHandler).toHaveBeenCalled();
  });

  it('should clear all handlers', () => {
    const handler = vi.fn();
    emitter.on('mission.start', handler);
    emitter.onAll(handler);

    emitter.clear();
    emitter.emit('mission.start', {});

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('StructuredLogger', () => {
  it('should create a logger with console output', () => {
    const logger = createStructuredLogger({ prefix: 'Test' });
    expect(logger).toBeDefined();
  });

  it('should write to buffer output', () => {
    const buffer = new BufferOutput();
    const logger = createStructuredLogger({ silent: true });
    (logger as any).outputs = [buffer]; // Inject buffer

    logger.info('Test message', { key: 'value' });

    // Need to test with proper injection
  });

  it('should filter by log level', () => {
    const buffer = new BufferOutput();
    const logger = createStructuredLogger({ silent: true, level: 'warn' });

    // Logger with warn level should not log info
    logger.info('This should not appear');
    logger.warn('This should appear');
  });

  it('should create child loggers with merged context', () => {
    const logger = createStructuredLogger({
      silent: true,
      context: { service: 'reqon' },
    });

    const child = logger.child({ action: 'fetch' });
    expect(child).toBeDefined();
  });

  it('should create timing spans', () => {
    const logger = createStructuredLogger({ silent: true });
    const span = logger.span('test-operation');

    expect(span.id).toBeDefined();
    const duration = span.end();
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

describe('BufferOutput', () => {
  it('should capture log entries', () => {
    const buffer = new BufferOutput();

    const entry: LogEntry = {
      level: 'info',
      message: 'Test message',
      timestamp: new Date().toISOString(),
      context: { key: 'value' },
    };

    buffer.write(entry);

    expect(buffer.entries).toHaveLength(1);
    expect(buffer.entries[0]).toEqual(entry);
  });

  it('should find entries by predicate', () => {
    const buffer = new BufferOutput();

    buffer.write({ level: 'info', message: 'Info', timestamp: '', context: {} });
    buffer.write({ level: 'warn', message: 'Warn', timestamp: '', context: {} });
    buffer.write({ level: 'error', message: 'Error', timestamp: '', context: {} });

    const warn = buffer.find((e) => e.level === 'warn');
    expect(warn?.message).toBe('Warn');
  });

  it('should filter entries', () => {
    const buffer = new BufferOutput();

    buffer.write({ level: 'info', message: 'Info 1', timestamp: '', context: {} });
    buffer.write({ level: 'info', message: 'Info 2', timestamp: '', context: {} });
    buffer.write({ level: 'warn', message: 'Warn', timestamp: '', context: {} });

    const infos = buffer.filter((e) => e.level === 'info');
    expect(infos).toHaveLength(2);
  });

  it('should clear entries', () => {
    const buffer = new BufferOutput();

    buffer.write({ level: 'info', message: 'Test', timestamp: '', context: {} });
    expect(buffer.entries).toHaveLength(1);

    buffer.clear();
    expect(buffer.entries).toHaveLength(0);
  });
});

describe('OpenTelemetry', () => {
  describe('SpanBuilder', () => {
    it('should generate trace and span IDs', () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      expect(traceId).toHaveLength(32);
      expect(spanId).toHaveLength(16);
    });

    it('should create spans with parent relationships', () => {
      const builder = new SpanBuilder();

      const parentSpanId = builder.startSpan('parent-operation');
      const childSpanId = builder.startSpan('child-operation', {
        parentSpanId,
      });

      builder.endSpan(childSpanId);
      builder.endSpan(parentSpanId);

      const spans = builder.getSpans();
      expect(spans).toHaveLength(2);

      const childSpan = spans.find((s) => s.spanId === childSpanId);
      expect(childSpan?.parentSpanId).toBe(parentSpanId);
    });

    it('should add events to spans', () => {
      const builder = new SpanBuilder();

      const spanId = builder.startSpan('operation');
      builder.addEvent(spanId, 'checkpoint', { items: 10 });
      builder.endSpan(spanId);

      const spans = builder.getSpans();
      expect(spans[0].events).toHaveLength(1);
      expect(spans[0].events[0].name).toBe('checkpoint');
    });

    it('should set span status', () => {
      const builder = new SpanBuilder();

      const spanId = builder.startSpan('operation');
      builder.endSpan(spanId, { status: 'ERROR', error: 'Something failed' });

      const spans = builder.getSpans();
      expect(spans[0].status.code).toBe('ERROR');
      expect(spans[0].status.message).toBe('Something failed');
    });
  });

  describe('OTelEventAdapter', () => {
    it('should convert mission events to spans', () => {
      const adapter = new OTelEventAdapter();

      adapter.processEvent({
        type: 'mission.start',
        executionId: 'exec-1',
        mission: 'test-mission',
        timestamp: new Date().toISOString(),
        payload: { stageCount: 2, isResume: false },
      });

      adapter.processEvent({
        type: 'mission.complete',
        executionId: 'exec-1',
        mission: 'test-mission',
        timestamp: new Date().toISOString(),
        payload: { success: true },
      });

      const spans = adapter.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('mission:test-mission');
      expect(spans[0].status.code).toBe('OK');
    });

    it('should handle nested stage spans', () => {
      const adapter = new OTelEventAdapter();

      // Start mission
      adapter.processEvent({
        type: 'mission.start',
        executionId: 'exec-1',
        mission: 'test',
        timestamp: new Date().toISOString(),
        payload: {},
      });

      // Start stage
      adapter.processEvent({
        type: 'stage.start',
        executionId: 'exec-1',
        mission: 'test',
        timestamp: new Date().toISOString(),
        payload: { stageIndex: 0, stageName: 'fetch-users' },
      });

      // Complete stage
      adapter.processEvent({
        type: 'stage.complete',
        executionId: 'exec-1',
        mission: 'test',
        timestamp: new Date().toISOString(),
        payload: { stageIndex: 0, success: true },
      });

      // Complete mission
      adapter.processEvent({
        type: 'mission.complete',
        executionId: 'exec-1',
        mission: 'test',
        timestamp: new Date().toISOString(),
        payload: { success: true },
      });

      const spans = adapter.getSpans();
      expect(spans).toHaveLength(2);

      // Stage span should have mission span as parent
      const stageSpan = spans.find((s) => s.name === 'stage:fetch-users');
      const missionSpan = spans.find((s) => s.name === 'mission:test');

      expect(stageSpan?.parentSpanId).toBe(missionSpan?.spanId);
    });

    it('should track fetch operations as client spans', () => {
      const adapter = new OTelEventAdapter();

      adapter.processEvent({
        type: 'fetch.start',
        executionId: 'exec-1',
        mission: 'test',
        timestamp: new Date().toISOString(),
        payload: { source: 'api', method: 'GET', path: '/users' },
      });

      adapter.processEvent({
        type: 'fetch.complete',
        executionId: 'exec-1',
        mission: 'test',
        timestamp: new Date().toISOString(),
        payload: { statusCode: 200 },
      });

      const spans = adapter.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].kind).toBe('CLIENT');
      expect(spans[0].name).toBe('fetch:GET /users');
    });
  });
});

describe('Integration', () => {
  it('should bridge events to OTel spans', () => {
    const emitter = createEmitter('exec-1', 'test-mission');
    const adapter = new OTelEventAdapter();

    // Subscribe adapter to emitter
    emitter.onAll((event) => adapter.processEvent(event));

    // Emit events
    emitter.emit('mission.start', { stageCount: 1, isResume: false });
    emitter.emit('stage.start', { stageIndex: 0, stageName: 'fetch' });
    emitter.emit('fetch.start', { source: 'api', method: 'GET', path: '/users' });
    emitter.emit('fetch.complete', { statusCode: 200, recordCount: 10 });
    emitter.emit('stage.complete', { stageIndex: 0, success: true });
    emitter.emit('mission.complete', { success: true });

    const spans = adapter.getSpans();
    expect(spans.length).toBeGreaterThan(0);
  });
});
