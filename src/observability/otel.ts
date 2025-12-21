/**
 * OpenTelemetry Integration - Trace and metrics export
 *
 * Provides adapters for exporting observability data to OpenTelemetry-compatible
 * backends (Jaeger, Zipkin, OTLP, etc.)
 *
 * This is a lightweight implementation that doesn't require the full OTel SDK.
 * For production use, consider using the official @opentelemetry packages.
 */

import type { ObservabilityEvent, EventType, EventEmitter } from './events.js';
import type { LogEntry, LogOutput } from './logger.js';

/** OTLP-compatible span structure */
export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OTelAttribute[];
  status: { code: 'UNSET' | 'OK' | 'ERROR'; message?: string };
  events: OTelSpanEvent[];
}

export interface OTelAttribute {
  key: string;
  value: { stringValue?: string; intValue?: number; boolValue?: boolean };
}

export interface OTelSpanEvent {
  name: string;
  timeUnixNano: string;
  attributes: OTelAttribute[];
}

/** Trace context for span correlation */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

// ============================================================================
// Trace Context Management
// ============================================================================

/**
 * Generate a 32-character hex trace ID
 */
export function generateTraceId(): string {
  return randomHex(32);
}

/**
 * Generate a 16-character hex span ID
 */
export function generateSpanId(): string {
  return randomHex(16);
}

function randomHex(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}

// ============================================================================
// OpenTelemetry Span Builder
// ============================================================================

export class SpanBuilder {
  private traceId: string;
  private spans: OTelSpan[] = [];
  private activeSpans: Map<string, { span: OTelSpan; startTime: number }> = new Map();

  constructor(traceId?: string) {
    this.traceId = traceId ?? generateTraceId();
  }

  getTraceId(): string {
    return this.traceId;
  }

  startSpan(
    name: string,
    options: {
      kind?: OTelSpan['kind'];
      parentSpanId?: string;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): string {
    const spanId = generateSpanId();
    const now = Date.now();

    const span: OTelSpan = {
      traceId: this.traceId,
      spanId,
      parentSpanId: options.parentSpanId,
      name,
      kind: options.kind ?? 'INTERNAL',
      startTimeUnixNano: (now * 1_000_000).toString(),
      endTimeUnixNano: '0',
      attributes: options.attributes ? this.toAttributes(options.attributes) : [],
      status: { code: 'UNSET' },
      events: [],
    };

    this.activeSpans.set(spanId, { span, startTime: now });
    return spanId;
  }

  endSpan(
    spanId: string,
    options: {
      status?: 'OK' | 'ERROR';
      error?: string;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): OTelSpan | undefined {
    const active = this.activeSpans.get(spanId);
    if (!active) return undefined;

    const { span } = active;
    const now = Date.now();

    span.endTimeUnixNano = (now * 1_000_000).toString();
    span.status = {
      code: options.status ?? 'OK',
      message: options.error,
    };

    if (options.attributes) {
      span.attributes.push(...this.toAttributes(options.attributes));
    }

    this.activeSpans.delete(spanId);
    this.spans.push(span);

    return span;
  }

  addEvent(
    spanId: string,
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    const active = this.activeSpans.get(spanId);
    if (!active) return;

    active.span.events.push({
      name,
      timeUnixNano: (Date.now() * 1_000_000).toString(),
      attributes: attributes ? this.toAttributes(attributes) : [],
    });
  }

  getSpans(): OTelSpan[] {
    return [...this.spans];
  }

  private toAttributes(attrs: Record<string, string | number | boolean>): OTelAttribute[] {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value:
        typeof value === 'string'
          ? { stringValue: value }
          : typeof value === 'number'
            ? { intValue: value }
            : { boolValue: value },
    }));
  }
}

// ============================================================================
// OpenTelemetry Event Adapter
// ============================================================================

/**
 * Adapts observability events to OpenTelemetry spans
 */
export class OTelEventAdapter {
  private spanBuilder: SpanBuilder;
  private spanStack: string[] = [];
  private eventToSpan: Map<string, string> = new Map();

  constructor(traceId?: string) {
    this.spanBuilder = new SpanBuilder(traceId);
  }

  /**
   * Process an observability event and update spans
   */
  processEvent(event: ObservabilityEvent): void {
    const { type, payload } = event;

    // Map event types to span operations
    switch (type) {
      case 'mission.start':
        this.startMissionSpan(event);
        break;
      case 'mission.complete':
      case 'mission.failed':
        this.endMissionSpan(event);
        break;
      case 'stage.start':
        this.startStageSpan(event);
        break;
      case 'stage.complete':
        this.endStageSpan(event);
        break;
      case 'step.start':
        this.startStepSpan(event);
        break;
      case 'step.complete':
        this.endStepSpan(event);
        break;
      case 'fetch.start':
        this.startFetchSpan(event);
        break;
      case 'fetch.complete':
      case 'fetch.error':
        this.endFetchSpan(event);
        break;
      default:
        // Add as event to current span
        this.addEventToCurrentSpan(event);
    }
  }

  private startMissionSpan(event: ObservabilityEvent): void {
    const spanId = this.spanBuilder.startSpan(`mission:${event.mission}`, {
      kind: 'INTERNAL',
      attributes: {
        'reqon.execution_id': event.executionId,
        'reqon.mission': event.mission,
      },
    });
    this.spanStack.push(spanId);
    this.eventToSpan.set('mission', spanId);
  }

  private endMissionSpan(event: ObservabilityEvent): void {
    const spanId = this.eventToSpan.get('mission');
    if (spanId) {
      const payload = event.payload as { success?: boolean; error?: string };
      this.spanBuilder.endSpan(spanId, {
        status: payload.success === false ? 'ERROR' : 'OK',
        error: payload.error,
      });
      this.spanStack.pop();
    }
  }

  private startStageSpan(event: ObservabilityEvent): void {
    const payload = event.payload as { stageName: string; stageIndex: number };
    const parentSpanId = this.spanStack[this.spanStack.length - 1];
    const spanId = this.spanBuilder.startSpan(`stage:${payload.stageName}`, {
      kind: 'INTERNAL',
      parentSpanId,
      attributes: {
        'reqon.stage.name': payload.stageName,
        'reqon.stage.index': payload.stageIndex,
      },
    });
    this.spanStack.push(spanId);
    this.eventToSpan.set(`stage:${payload.stageIndex}`, spanId);
  }

  private endStageSpan(event: ObservabilityEvent): void {
    const payload = event.payload as { stageIndex: number; success: boolean; error?: string };
    const spanId = this.eventToSpan.get(`stage:${payload.stageIndex}`);
    if (spanId) {
      this.spanBuilder.endSpan(spanId, {
        status: payload.success ? 'OK' : 'ERROR',
        error: payload.error,
      });
      this.spanStack.pop();
    }
  }

  private startStepSpan(event: ObservabilityEvent): void {
    const payload = event.payload as { actionName: string; stepIndex: number; stepType: string };
    const parentSpanId = this.spanStack[this.spanStack.length - 1];
    const spanId = this.spanBuilder.startSpan(`step:${payload.stepType}`, {
      kind: 'INTERNAL',
      parentSpanId,
      attributes: {
        'reqon.step.type': payload.stepType,
        'reqon.step.index': payload.stepIndex,
        'reqon.action': payload.actionName,
      },
    });
    this.spanStack.push(spanId);
    this.eventToSpan.set(`step:${payload.actionName}:${payload.stepIndex}`, spanId);
  }

  private endStepSpan(event: ObservabilityEvent): void {
    const payload = event.payload as {
      actionName: string;
      stepIndex: number;
      success: boolean;
      error?: string;
    };
    const spanId = this.eventToSpan.get(`step:${payload.actionName}:${payload.stepIndex}`);
    if (spanId) {
      this.spanBuilder.endSpan(spanId, {
        status: payload.success ? 'OK' : 'ERROR',
        error: payload.error,
      });
      this.spanStack.pop();
    }
  }

  private startFetchSpan(event: ObservabilityEvent): void {
    const payload = event.payload as { source: string; method: string; path: string };
    const parentSpanId = this.spanStack[this.spanStack.length - 1];
    const spanId = this.spanBuilder.startSpan(`fetch:${payload.method} ${payload.path}`, {
      kind: 'CLIENT',
      parentSpanId,
      attributes: {
        'http.method': payload.method,
        'http.url': payload.path,
        'reqon.source': payload.source,
      },
    });
    this.eventToSpan.set('fetch:current', spanId);
  }

  private endFetchSpan(event: ObservabilityEvent): void {
    const spanId = this.eventToSpan.get('fetch:current');
    if (spanId) {
      const payload = event.payload as { statusCode?: number; error?: string };
      this.spanBuilder.endSpan(spanId, {
        status: payload.error ? 'ERROR' : 'OK',
        error: payload.error,
        attributes: payload.statusCode ? { 'http.status_code': payload.statusCode } : undefined,
      });
      this.eventToSpan.delete('fetch:current');
    }
  }

  private addEventToCurrentSpan(event: ObservabilityEvent): void {
    const spanId = this.spanStack[this.spanStack.length - 1];
    if (spanId) {
      this.spanBuilder.addEvent(spanId, event.type, event.payload as Record<string, string | number | boolean>);
    }
  }

  getSpans(): OTelSpan[] {
    return this.spanBuilder.getSpans();
  }

  getTraceId(): string {
    return this.spanBuilder.getTraceId();
  }
}

// ============================================================================
// OTLP Exporter
// ============================================================================

export interface OTLPExporterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
}

/**
 * Export spans to an OTLP-compatible endpoint
 */
export class OTLPExporter {
  private config: OTLPExporterConfig;
  private pendingSpans: OTelSpan[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(config: OTLPExporterConfig) {
    this.config = config;
  }

  addSpans(spans: OTelSpan[]): void {
    this.pendingSpans.push(...spans);
  }

  async flush(): Promise<void> {
    if (this.pendingSpans.length === 0) return;

    const spans = this.pendingSpans;
    this.pendingSpans = [];

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: this.config.serviceName ?? 'reqon' },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'reqon', version: '1.0.0' },
              spans,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`OTLP export failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('OTLP export error:', error);
    }
  }

  startAutoFlush(intervalMs = 5000): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, intervalMs);
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}

// ============================================================================
// Log Output for OTel
// ============================================================================

/**
 * Log output that converts entries to OTel spans
 */
export class OTelLogOutput implements LogOutput {
  private adapter: OTelEventAdapter;
  private exporter?: OTLPExporter;

  constructor(adapter: OTelEventAdapter, exporter?: OTLPExporter) {
    this.adapter = adapter;
    this.exporter = exporter;
  }

  write(entry: LogEntry): void {
    // Only process span-related entries
    if (entry.spanId) {
      // Spans are handled by the event adapter
      return;
    }
  }

  getSpans(): OTelSpan[] {
    return this.adapter.getSpans();
  }

  async flush(): Promise<void> {
    if (this.exporter) {
      this.exporter.addSpans(this.adapter.getSpans());
      await this.exporter.flush();
    }
  }
}

// ============================================================================
// Event Listener for OTel
// ============================================================================

/**
 * Create an event listener that builds OTel spans
 */
export function createOTelListener(
  config?: OTLPExporterConfig
): {
  adapter: OTelEventAdapter;
  handler: (event: ObservabilityEvent) => void;
  flush: () => Promise<void>;
} {
  const adapter = new OTelEventAdapter();
  const exporter = config ? new OTLPExporter(config) : undefined;

  return {
    adapter,
    handler: (event: ObservabilityEvent) => {
      adapter.processEvent(event);
    },
    flush: async () => {
      if (exporter) {
        exporter.addSpans(adapter.getSpans());
        await exporter.flush();
      }
    },
  };
}
