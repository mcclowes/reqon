import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute, MissionExecutor, parse } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { loadState } from '../execution-log/index.js';
import { MemoryStore } from '../stores/index.js';
import type { StoredEvent } from '../execution-log/index.js';

/**
 * Durable connectors (#142): a `backfill` paginated fetch persists per-page
 * progress to the execution log, so an arbitrarily large fetch completes across
 * runs — each run bounded in memory — and a restart continues from the last
 * persisted page rather than re-fetching from the start.
 */
describe('resumable backfill pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A finite offset-paginated API over 6 records, page size 2.
  const DATASET = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));

  function mockApi() {
    const offsetsFetched: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = new URL(typeof url === 'string' ? url : url.toString());
        const offset = Number(u.searchParams.get('offset') ?? '0');
        offsetsFetched.push(offset);
        const page = DATASET.slice(offset, offset + 2);
        return new Response(JSON.stringify({ items: page }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    return offsetsFetched;
  }

  const source = `
    mission Backfill {
      source Api { auth: none, base: "https://api.example.test" }
      store out: memory("out")
      action Pull {
        get "/items" {
          paginate: offset(offset, 2),
          backfill: true
        }
        store response -> out { key: .id }
      }
      run Pull
    }
  `;

  it('completes across memory-bounded runs without re-fetching pages', async () => {
    const log = new MemoryExecutionLog();
    const offsets = mockApi();

    // One page (2 items) per run. Drive resumes until the backfill is done.
    let executionId: string | undefined;
    let done = false;
    let runs = 0;
    while (!done && runs < 10) {
      runs++;
      const result = await execute(source, {
        executionLog: log,
        resumeFrom: executionId,
        backfillMaxItemsPerRun: 2,
      });
      executionId = result.executionId;
      const state = await loadState(log, executionId!);
      done = state.pageProgress.get('Pull#0')?.done ?? false;
    }

    expect(done).toBe(true);

    // Each offset fetched exactly once across all runs — no page re-fetched.
    expect(offsets).toEqual([0, 2, 4, 6]);
    expect(new Set(offsets).size).toBe(offsets.length);

    // All six records landed in the store.
    const records = (await log.read(executionId!)).filter(
      (e): e is StoredEvent & { type: 'page.completed' } => e.type === 'page.completed'
    );
    const totalFetched = records.reduce((sum, e) => sum + (e.recordCount ?? 0), 0);
    expect(totalFetched).toBe(DATASET.length);
  });

  it('persists every page to the store across runs, not just the first', async () => {
    // Regression for the store-effect-identity bug: the effect id was keyed only
    // on (executionId, stepId, target), all stable across resumed runs, so every
    // run after the first found its store effect "already applied" and skipped
    // the write — silently dropping all but the first page's records.
    const log = new MemoryExecutionLog();
    const out = new MemoryStore('out');
    mockApi();

    let executionId: string | undefined;
    let done = false;
    let runs = 0;
    while (!done && runs < 10) {
      runs++;
      const result = await new MissionExecutor({
        executionLog: log,
        stores: { out },
        resumeFrom: executionId,
        backfillMaxItemsPerRun: 2,
      }).execute(parse(source));
      executionId = result.executionId;
      done = (await loadState(log, executionId!)).pageProgress.get('Pull#0')?.done ?? false;
    }

    expect(done).toBe(true);
    const stored = (await out.list()).map((r) => r.id).sort((a, b) => Number(a) - Number(b));
    expect(stored).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('a run after completion fetches nothing', async () => {
    const log = new MemoryExecutionLog();
    let offsets = mockApi();

    let executionId: string | undefined;
    let done = false;
    while (!done) {
      const result = await execute(source, {
        executionLog: log,
        resumeFrom: executionId,
        backfillMaxItemsPerRun: 2,
      });
      executionId = result.executionId;
      done = (await loadState(log, executionId!)).pageProgress.get('Pull#0')?.done ?? false;
    }

    // Resume once more after the backfill is already complete.
    vi.unstubAllGlobals();
    offsets = mockApi();
    await execute(source, {
      executionLog: log,
      resumeFrom: executionId,
      backfillMaxItemsPerRun: 2,
    });
    expect(offsets).toEqual([]); // skipped — nothing left to fetch
  });

  it('resumes cursor pagination from the persisted cursor', async () => {
    // A cursor API: each page returns the next cursor; the run resumes from it.
    const pages: Record<string, { items: { id: number }[]; next?: string }> = {
      start: { items: [{ id: 1 }, { id: 2 }], next: 'c1' },
      c1: { items: [{ id: 3 }, { id: 4 }], next: 'c2' },
      c2: { items: [{ id: 5 }], next: undefined },
    };
    const cursorsSeen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = new URL(typeof url === 'string' ? url : url.toString());
        const cursor = u.searchParams.get('cursor') ?? 'start';
        cursorsSeen.push(cursor);
        const page = pages[cursor];
        return new Response(JSON.stringify({ items: page.items, nextCursor: page.next }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    const cursorSource = `
      mission Backfill {
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Pull {
          get "/items" {
            paginate: cursor(cursor, 2, "nextCursor"),
            backfill: true
          }
          store response -> out { key: .id }
        }
        run Pull
      }
    `;

    const log = new MemoryExecutionLog();
    let executionId: string | undefined;
    let done = false;
    let runs = 0;
    while (!done && runs < 10) {
      runs++;
      const result = await execute(cursorSource, {
        executionLog: log,
        resumeFrom: executionId,
        backfillMaxItemsPerRun: 2,
      });
      executionId = result.executionId;
      done = (await loadState(log, executionId!)).pageProgress.get('Pull#0')?.done ?? false;
    }

    expect(done).toBe(true);
    // Each cursor visited once, in order — resume picked up the saved cursor.
    expect(cursorsSeen).toEqual(['start', 'c1', 'c2']);
  });
});
