import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { execute } from '../index.js';
import { ObservabilityEmitter } from '../observability/index.js';
import type { ExecutionResult } from './executor.js';

/**
 * Hostile-API fixture (epic #264, suggested-order step 3): one mock server
 * that misbehaves in every way this codebase's review found APIs actually
 * misbehave — garbage rate-limit headers, alternating cursors, short middle
 * pages, `{errors: [], data: [...]}` envelopes, 403 on everything, and bodies
 * that never finish.
 *
 * The one invariant every scenario asserts: the run never reports
 * `success: true` with zero records *silently*. Either records were stored,
 * or the failure is loud — result.success is false, errors are populated, or
 * damage is surfaced via toleratedFailures / a truncation event.
 */

/** A real HTTP server whose behavior each test swaps in. */
class HostileServer {
  private server?: Server;
  private sockets = new Set<Socket>();
  port = 0;
  handler: (req: IncomingMessage, res: ServerResponse, url: URL) => void = (_req, res) => {
    res.writeHead(500).end();
  };

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
      this.handler(req, res, url);
    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Destroy sockets first: hung-body scenarios leave connections open on
    // purpose, and close() would wait on them forever.
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}

const server = new HostileServer();

beforeAll(() => server.start());
afterAll(() => server.stop());
afterEach(() => {
  vi.restoreAllMocks();
});

const json = (
  res: ServerResponse,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** Records currently in the mission's `out` store. */
async function storedRecords(result: ExecutionResult): Promise<unknown[]> {
  const store = result.stores.get('out');
  return store ? await store.list() : [];
}

/**
 * The epic's core invariant: a clean, empty success must not exist. An empty
 * success is only acceptable when the run surfaced its damage some other way.
 */
async function expectNoSilentEmptySuccess(result: ExecutionResult): Promise<void> {
  const records = await storedRecords(result);
  if (result.success && records.length === 0) {
    expect(result.toleratedFailures ?? []).not.toHaveLength(0);
  }
}

/** A plain fetch-and-store mission against the hostile server. */
const mission = (fetchBlock: string, storeExpr = 'response') => `
  mission Hostile {
    source Api { auth: none, base: "${server.base}" }
    store out: memory("out")
    action Pull {
      ${fetchBlock}
      store ${storeExpr} -> out { key: .id }
    }
    run Pull
  }
`;

describe('hostile API fixture', () => {
  it('survives garbage rate-limit headers and still fetches everything', async () => {
    server.handler = (_req, res, url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
      json(res, { items: all.slice(offset, offset + 2) }, 200, {
        'x-ratelimit-limit': '-5',
        'x-ratelimit-remaining': 'banana',
        'x-ratelimit-reset': 'soon',
        'retry-after': 'whenever',
      });
    };

    const result = await execute(mission(`get "/items" { paginate: offset(offset, 2) }`));

    expect(result.success).toBe(true);
    expect(await storedRecords(result)).toHaveLength(3);
  });

  it('recovers from a 429 whose Retry-After is garbage', async () => {
    let calls = 0;
    server.handler = (_req, res) => {
      calls++;
      if (calls === 1) {
        json(res, { error: 'slow down' }, 429, { 'retry-after': 'soon-ish' });
        return;
      }
      json(res, { items: [{ id: 1 }] });
    };

    const result = await execute(
      mission(
        `get "/items" { retry: { maxAttempts: 3, backoff: constant, initialDelay: 1 } }`,
        'response.items'
      )
    );

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(await storedRecords(result)).toHaveLength(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  }, 15_000);

  it('terminates an alternating-cursor loop and surfaces the truncation', async () => {
    server.handler = (_req, res, url) => {
      const cursor = url.searchParams.get('cursor');
      // A ↔ B forever: every page is full and names a next cursor.
      json(res, {
        items: cursor === 'A' ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }, { id: 4 }],
        nextCursor: cursor === 'A' ? 'B' : 'A',
      });
    };

    const emitter = new ObservabilityEmitter('hostile-exec', 'Hostile');
    let truncated = false;
    emitter.on('fetch.truncated', () => {
      truncated = true;
    });

    const result = await execute(
      mission(`get "/items" { paginate: cursor(cursor, 2, "nextCursor") }`),
      { eventEmitter: emitter, maxPaginationPages: 4 }
    );

    // Bounded, loud, and not an empty success.
    expect(truncated).toBe(true);
    expect((await storedRecords(result)).length).toBeGreaterThan(0);
    await expectNoSilentEmptySuccess(result);
  });

  it('stops offset pagination at a short middle page without inventing a clean zero', async () => {
    server.handler = (_req, res, url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      // Page sizes 2, then 1 (short), then more data the API hides behind the
      // short page. The standard termination heuristic stops at the short page.
      const pages: Record<number, { id: number }[]> = {
        0: [{ id: 1 }, { id: 2 }],
        2: [{ id: 3 }],
        4: [{ id: 5 }, { id: 6 }],
      };
      json(res, { items: pages[offset] ?? [] });
    };

    const result = await execute(mission(`get "/items" { paginate: offset(offset, 2) }`));

    expect(result.success).toBe(true);
    // What was fetched is stored; the short page ended pagination.
    expect(await storedRecords(result)).toHaveLength(3);
  });

  it('picks the data array of an {errors: [], data: [...]} envelope, loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    server.handler = (_req, res, url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
      json(res, { errors: [], data: all.slice(offset, offset + 2) });
    };

    const result = await execute(mission(`get "/items" { paginate: offset(offset, 2) }`));

    expect(result.success).toBe(true);
    expect(await storedRecords(result)).toHaveLength(3);
    // The guess is still a guess, and it must say so.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('guessed'));
  });

  it('fails loudly when every request 403s, instead of reporting a clean empty run', async () => {
    server.handler = (_req, res) => {
      json(res, { error: 'forbidden' }, 403);
    };

    const result = await execute(mission(`get "/items"`));

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('403');
    expect(await storedRecords(result)).toHaveLength(0);
  });

  it('times out a 200 whose body never finishes, instead of hanging forever', async () => {
    server.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"items": [{"id": 1}'); // never completed, never ended
    };

    const result = await execute(
      mission(
        `get "/items" { retry: { maxAttempts: 2, backoff: constant, initialDelay: 1, timeout: 250 } }`
      )
    );

    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(' ')).toMatch(/timed out/i);
    await expectNoSilentEmptySuccess(result);
  });

  it('times out a 403 whose error body never finishes', async () => {
    server.handler = (_req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.write('{"error": "denied'); // stalls the error-snippet read
    };

    const result = await execute(
      mission(
        `get "/items" { retry: { maxAttempts: 1, backoff: constant, initialDelay: 1, timeout: 250 } }`
      )
    );

    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(' ')).toContain('403');
  });
});
