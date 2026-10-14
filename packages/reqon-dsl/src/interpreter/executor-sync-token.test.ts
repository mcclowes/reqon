import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../index.js';
import { MemorySyncStore } from '../sync/index.js';
import { MemoryExecutionLog, LogBackedSyncStore } from '../index.js';

/**
 * Opaque sync tokens (Google People `nextSyncToken`, Graph delta links): the
 * API hands back a token on the last page that must be sent verbatim next run.
 */
const source = `
  mission Sync {
    source Api { auth: none, base: "https://api.example.test" }
    store out: memory("out")
    action Pull {
      get "/people" {
        paginate: cursor(pageToken, 2, "nextPageToken", "connections"),
        since: lastSync("people") { param: "syncToken", token: "nextSyncToken" }
      }
      store response -> out { key: .id }
    }
    run Pull
  }
`;

type Page = { connections: { id: number }[]; nextPageToken?: string; nextSyncToken?: string };

function server(pages: Page[]) {
  const requests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = new URL(url.toString());
      requests.push(u);
      const token = u.searchParams.get('pageToken');
      const page = token ? pages[Number(token)] : pages[0];
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  return requests;
}

describe('since: lastSync { token }', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends no token on the first run and records the last page token', async () => {
    const syncStore = new MemorySyncStore();
    const requests = server([
      { connections: [{ id: 1 }, { id: 2 }], nextPageToken: '1', nextSyncToken: 'stale' },
      { connections: [{ id: 3 }], nextSyncToken: 'sync-A' },
    ]);

    const result = await execute(source, { syncStore });

    expect(result.success).toBe(true);
    expect(requests.map((u) => u.searchParams.get('syncToken'))).toEqual([null, null]);
    expect((await syncStore.getCheckpoint('people'))?.cursor).toBe('sync-A');
  });

  it('sends the stored token verbatim on every page of the next run', async () => {
    const syncStore = new MemorySyncStore();
    await syncStore.recordSync({ key: 'people', syncedAt: new Date(), cursor: 'tok/+=?&' });
    const requests = server([
      { connections: [{ id: 1 }, { id: 2 }], nextPageToken: '1' },
      { connections: [], nextSyncToken: 'sync-B' },
    ]);

    await execute(source, { syncStore });

    expect(requests.map((u) => u.searchParams.get('syncToken'))).toEqual(['tok/+=?&', 'tok/+=?&']);
    expect((await syncStore.getCheckpoint('people'))?.cursor).toBe('sync-B');
  });

  it('keeps the previous token when the response carries none', async () => {
    const syncStore = new MemorySyncStore();
    await syncStore.recordSync({ key: 'people', syncedAt: new Date(0), cursor: 'keep-me' });
    server([{ connections: [{ id: 1 }] }]);

    const result = await execute(source, { syncStore });

    expect(result.success).toBe(true);
    expect((await syncStore.getCheckpoint('people'))?.cursor).toBe('keep-me');
  });

  it('persists the token through the durable execution log', async () => {
    const executionLog = new MemoryExecutionLog();
    server([{ connections: [{ id: 1 }], nextSyncToken: 'logged' }]);
    await execute(source, { executionLog });

    const requests = server([{ connections: [], nextSyncToken: 'next' }]);
    await execute(source, { executionLog });

    expect(requests[0].searchParams.get('syncToken')).toBe('logged');
    const store = new LogBackedSyncStore(executionLog, 'Sync');
    expect((await store.getCheckpoint('people'))?.cursor).toBe('next');
  });
});

describe('parser: since token option', () => {
  it('rejects a non-string token path', async () => {
    const bad = source.replace('token: "nextSyncToken"', 'token: 42');
    const result = await execute(bad).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
  });
});
