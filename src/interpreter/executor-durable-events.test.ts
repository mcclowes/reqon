import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { MemorySyncStore } from '../sync/index.js';
import { MemoryPauseStore } from '../pause/index.js';
import type { StoredEvent } from '../execution-log/index.js';

/**
 * Coverage for the remaining execution-log event types that complete the
 * durable record: checkpoint.advanced (incremental sync) and the pause
 * lifecycle (pause.created on suspend, pause.resumed on replay of a paused
 * run). With these, foldLog reconstructs the full run state from the log alone.
 */
describe('executor logs checkpoint.advanced for incremental sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records checkpoint.advanced with the key and a syncedAt when a sync checkpoint flushes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: 1, name: 'A' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    const source = `
      mission Sync {
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Pull {
          get "/items" {
            since: lastSync
          }
          store response -> out { key: .id }
        }
        run Pull
      }
    `;

    const log = new MemoryExecutionLog();
    const result = await execute(source, {
      executionLog: log,
      syncStore: new MemorySyncStore(),
    });

    expect(result.success).toBe(true);
    const events = await log.read(result.executionId!);
    const advanced = events.find((e) => e.type === 'checkpoint.advanced') as
      (StoredEvent & { type: 'checkpoint.advanced' }) | undefined;

    expect(advanced).toBeDefined();
    expect(advanced!.key.length).toBeGreaterThan(0);
    expect(() => new Date(advanced!.syncedAt).toISOString()).not.toThrow();
  });

  it('logs no checkpoint.advanced when the fetch has no since clause', async () => {
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
      mission Plain {
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Pull {
          get "/items"
          store response -> out { key: .id }
        }
        run Pull
      }
    `;

    const log = new MemoryExecutionLog();
    const result = await execute(source, { executionLog: log, syncStore: new MemorySyncStore() });

    const types = (await log.read(result.executionId!)).map((e) => e.type);
    expect(types).not.toContain('checkpoint.advanced');
  });
});

describe('executor logs the pause lifecycle', () => {
  const pauseSource = `
    mission Waiter {
      source Api { auth: none, base: "https://api.example.test" }
      store out: memory("out")
      action Hold {
        pause {
          duration: "7d",
          resumeOn: timeout
        }
      }
      run Hold
    }
  `;

  it('records pause.created when a mission suspends on a pause step', async () => {
    const log = new MemoryExecutionLog();
    const result = await execute(pauseSource, {
      executionLog: log,
      pauseStore: new MemoryPauseStore(),
    });

    const events = await log.read(result.executionId!);
    const created = events.find((e) => e.type === 'pause.created') as
      (StoredEvent & { type: 'pause.created' }) | undefined;

    expect(created).toBeDefined();
    expect(created!.pauseId.length).toBeGreaterThan(0);
    // A suspended run must not be recorded as completed.
    expect(events.map((e) => e.type)).not.toContain('mission.completed');
  });

  it('records pause.resumed when replaying a run whose log ended paused', async () => {
    const log = new MemoryExecutionLog();
    const first = await execute(pauseSource, {
      executionLog: log,
      pauseStore: new MemoryPauseStore(),
    });
    expect((await log.read(first.executionId!)).map((e) => e.type)).toContain('pause.created');

    // Resume the same execution id against the same log: replay must record
    // that the pending pause was resumed before continuing.
    const second = await execute(pauseSource, {
      executionLog: log,
      resumeFrom: first.executionId,
      pauseStore: new MemoryPauseStore(),
    });

    expect(second.executionId).toBe(first.executionId);
    const types = (await log.read(first.executionId!)).map((e) => e.type);
    expect(types).toContain('pause.resumed');
  });
});
