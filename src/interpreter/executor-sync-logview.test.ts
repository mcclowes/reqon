import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import type { StoredEvent } from '../execution-log/index.js';

/**
 * Sync as a log view (#137): in durable mode there is no separate sync store —
 * `lastSync` resolves from the `checkpoint.advanced` events in the execution
 * log. A run records its checkpoint to the log; the next run reads it straight
 * back to build its incremental `since` window.
 */
describe('durable incremental sync derives lastSync from the execution log', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  function captureSinceParam() {
    const sinceParams: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = new URL(typeof url === 'string' ? url : url.toString());
        sinceParams.push(u.searchParams.get('since'));
        return new Response(JSON.stringify([{ id: 1, name: 'A' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    return sinceParams;
  }

  it('a second run sends the first run’s checkpoint as its since window', async () => {
    const log = new MemoryExecutionLog();

    // Run 1: no prior checkpoint, so it syncs from the epoch and records one.
    const run1Params = captureSinceParam();
    const first = await execute(source, { executionLog: log });
    expect(first.success).toBe(true);
    expect(run1Params[0]).toBe(new Date(0).toISOString());

    const advanced = (await log.read(first.executionId!)).find(
      (e) => e.type === 'checkpoint.advanced'
    ) as (StoredEvent & { type: 'checkpoint.advanced' }) | undefined;
    expect(advanced).toBeDefined();

    // Run 2 (a fresh execution against the same log): lastSync comes from the
    // log — no separate sync store involved — so its since window is run 1's
    // recorded checkpoint, not the epoch.
    vi.unstubAllGlobals();
    const run2Params = captureSinceParam();
    const second = await execute(source, { executionLog: log });
    expect(second.executionId).not.toBe(first.executionId);
    expect(run2Params[0]).toBe(advanced!.syncedAt);
    expect(run2Params[0]).not.toBe(new Date(0).toISOString());
  });
});
