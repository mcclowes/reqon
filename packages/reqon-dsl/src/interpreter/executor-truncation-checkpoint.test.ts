import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import type { StoredEvent } from '../execution-log/index.js';

/**
 * #246: a paginated incremental sync that hits a pagination cap truncates the
 * result. The sync checkpoint MUST NOT advance past the un-fetched records — the
 * next incremental run asks for changes since the watermark, so anything beyond
 * the cap that predates it would never be fetched again (permanent data loss,
 * reported as success). A truncated run therefore records no checkpoint, and the
 * next run repeats the same `since` window.
 */
describe('a truncated paginated sync does not advance the checkpoint (#246)', () => {
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
          paginate: page(page, 2),
          since: lastSync
        }
        store response -> out { key: .id }
      }
      run Pull
    }
  `;

  /** An endless source: every page is full, so pagination never ends on its own. */
  function endlessServer() {
    const sinceParams: (string | null)[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = new URL(typeof url === 'string' ? url : url.toString());
        sinceParams.push(u.searchParams.get('since'));
        call++;
        const items = [{ id: call * 10 + 1 }, { id: call * 10 + 2 }];
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    return sinceParams;
  }

  it('records no checkpoint.advanced event when pagination is capped', async () => {
    const log = new MemoryExecutionLog();
    endlessServer();

    const result = await execute(source, { executionLog: log, maxPaginationPages: 3 });
    expect(result.success).toBe(true);

    const events = await log.read(result.executionId!);
    const advanced = events.find((e) => e.type === 'checkpoint.advanced');
    expect(advanced).toBeUndefined();
  });

  it('a second run repeats the same since window instead of skipping the gap', async () => {
    const log = new MemoryExecutionLog();

    endlessServer();
    const first = await execute(source, { executionLog: log, maxPaginationPages: 3 });
    expect(first.success).toBe(true);

    vi.unstubAllGlobals();
    const run2Params = endlessServer();
    const second = await execute(source, { executionLog: log, maxPaginationPages: 3 });
    expect(second.success).toBe(true);

    // Run 1 was truncated, so run 2 must still sync from the epoch — the
    // watermark never moved past the records the cap left unfetched.
    expect(run2Params[0]).toBe(new Date(0).toISOString());
  });

  it('a complete (uncapped) run still advances the checkpoint', async () => {
    const log = new MemoryExecutionLog();
    // A source that returns one short page and stops — pagination ends naturally.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [{ id: 1 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    const result = await execute(source, { executionLog: log, maxPaginationPages: 3 });
    expect(result.success).toBe(true);

    const events = await log.read(result.executionId!);
    const advanced = events.find((e) => e.type === 'checkpoint.advanced') as
      (StoredEvent & { type: 'checkpoint.advanced' }) | undefined;
    expect(advanced).toBeDefined();
  });
});
