import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../index.js';
import { MemoryTraceStore } from '../trace/index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { ObservabilityEmitter } from '../observability/index.js';
import type { ObservabilityEvent } from '../observability/index.js';

/**
 * #261: features that quietly do nothing, or report themselves as something
 * else. A declared feature either works or fails loudly, and every report of
 * an outcome derives from the same decision.
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('trace without persistState (#261.1)', () => {
  it('records a trace when trace: is declared but persistState is not', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse([{ id: 1 }]))
    );

    const source = `
      mission Traced {
        trace: full
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Pull {
          get "/items"
          store response -> out { key: .id }
        }
        run Pull
      }
    `;

    const traceStore = new MemoryTraceStore();
    const result = await execute(source, { traceStore });

    expect(result.success).toBe(true);
    expect(result.traceId).toBeDefined();
    const trace = await traceStore.load(result.traceId!);
    expect(trace).not.toBeNull();
    expect(trace!.snapshots.length).toBeGreaterThan(0);
  });
});

describe('apply step identity (#261.2)', () => {
  it('reports apply steps as apply, not fetch, in step events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 1, raw: 'x' }))
    );

    const source = `
      mission Applies {
        source Api { auth: none, base: "https://api.example.test" }
        transform Normalize -> StandardItem { id: .id }
        action Process {
          get "/items"
          apply Normalize to response
        }
        run Process
      }
    `;

    const emitter = new ObservabilityEmitter('test-exec', 'Applies');
    const stepTypes: string[] = [];
    emitter.on('step.start', (event: ObservabilityEvent<{ stepType: string }>) => {
      stepTypes.push(event.payload.stepType);
    });

    const result = await execute(source, { eventEmitter: emitter });

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(stepTypes).toContain('apply');
  });
});

describe('single-layer error recording (#261.3)', () => {
  it('records a failing step exactly once, not once per stack frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'nope' }, 404))
    );

    const source = `
      mission Fails {
        source Api { auth: none, base: "https://api.example.test" }
        action Pull {
          get "/items"
        }
        run Pull
      }
    `;

    const result = await execute(source);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/404/);
  });

  it('records a failure inside a for loop exactly once under onError abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('/detail/')
          ? jsonResponse({ error: 'gone' }, 404)
          : jsonResponse([{ id: 1 }])
      )
    );

    const source = `
      mission Nested {
        source Api { auth: none, base: "https://api.example.test" }
        action Pull {
          get "/items"
          for item in response onError abort {
            get "/detail/{item.id}"
          }
        }
        run Pull
      }
    `;

    const result = await execute(source);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

describe('outcome reported from one decision (#261.4)', () => {
  it('logs mission.failed (never mission.completed) for a failing run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'nope' }, 404))
    );

    const source = `
      mission Fails {
        source Api { auth: none, base: "https://api.example.test" }
        action Pull {
          get "/items"
        }
        run Pull
      }
    `;

    const log = new MemoryExecutionLog();
    const result = await execute(source, { executionLog: log });

    expect(result.success).toBe(false);
    const events = await log.read(result.executionId!);
    expect(events.filter((e) => e.type === 'mission.failed')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'mission.completed')).toHaveLength(0);
  });

  it('logs mission.completed for a run whose only failures were tolerated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('/detail/')
          ? jsonResponse({ error: 'gone' }, 404)
          : jsonResponse([{ id: 1 }])
      )
    );

    const source = `
      mission Tolerates {
        source Api { auth: none, base: "https://api.example.test" }
        action Pull {
          get "/items"
          for item in response {
            get "/detail/{item.id}"
          }
        }
        run Pull
      }
    `;

    const log = new MemoryExecutionLog();
    const result = await execute(source, { executionLog: log });

    expect(result.success).toBe(true);
    const events = await log.read(result.executionId!);
    expect(events.filter((e) => e.type === 'mission.completed')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'mission.failed')).toHaveLength(0);
  });
});
