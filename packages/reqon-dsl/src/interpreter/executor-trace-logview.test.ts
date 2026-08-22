import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { LogTraceView } from '../trace/index.js';

/**
 * Trace as a log view (#137): with a durable execution log, a run's timeline
 * and audit trail are reconstructable straight from the log — no separate trace
 * store needed for time-travel over the structural history.
 */
describe('durable run timeline is a view over the execution log', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reflects the steps and outcome of a completed run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: 1 }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    const source = `
      mission Pull {
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Fetch {
          get "/items"
          store response -> out { key: .id }
        }
        run Fetch
      }
    `;

    const log = new MemoryExecutionLog();
    const result = await execute(source, { executionLog: log });
    expect(result.success).toBe(true);

    const view = new LogTraceView(log, result.executionId!);
    const timeline = await view.timeline();

    expect(timeline[0].type).toBe('mission.started');
    expect(timeline.some((t) => t.type === 'step.started' && t.action === 'Fetch')).toBe(true);
    expect(timeline[timeline.length - 1].type).toBe('mission.completed');

    const summary = await view.summary();
    expect(summary.status).toBe('completed');
    expect(summary.stepsCompleted).toBeGreaterThan(0);
  });
});
