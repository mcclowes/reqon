import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { execute } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';

/**
 * Deterministic end-to-end coverage of the real fetch -> validate -> map ->
 * store pipeline. Unlike api-integration.test.ts (which hits live third-party
 * APIs and is skipped by default), this stubs the HTTP transport with canned
 * responses so the executor's real path runs offline and deterministically.
 */
describe('executor pipeline (mocked transport)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Stub global fetch to return a real Response with JSON for matched URLs. */
  function stubTransport(routes: Record<string, unknown>): Mock {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const match = Object.keys(routes).find((path) => url.includes(path));
      if (match === undefined) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(JSON.stringify(routes[match]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('fetches, validates, and stores a collection', async () => {
    const fetchMock = stubTransport({
      '/users': [
        { id: 1, name: 'Alice', email: 'alice@example.test' },
        { id: 2, name: 'Bob', email: 'bob@example.test' },
      ],
    });

    const source = `
      mission FetchUsers {
        source Api {
          auth: none,
          base: "https://api.example.test"
        }

        store users: memory("users")

        action Fetch {
          get "/users"

          validate response {
            assume length(response) > 0
          }

          store response -> users {
            key: .id
          }
        }

        run Fetch
      }
    `;

    const result = await execute(source, { verbose: false });

    expect(result.success).toBe(true);
    expect(result.actionsRun).toContain('Fetch');
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/users', expect.any(Object));

    const users = await result.stores.get('users')!.list();
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.id).sort()).toEqual([1, 2]);
    expect(users[0]).toHaveProperty('email');
  });

  it('maps fetched records into a transformed shape', async () => {
    stubTransport({
      '/users': [
        { id: 1, name: 'Alice', email: 'alice@example.test' },
        { id: 2, name: 'Bob', email: 'bob@example.test' },
      ],
    });

    const source = `
      mission Summarize {
        source Api {
          auth: none,
          base: "https://api.example.test"
        }

        store raw: memory("raw")
        store summary: memory("summary")

        action Fetch {
          get "/users"
          store response -> raw {
            key: .id
          }
        }

        action Transform {
          for user in raw {
            map user -> UserSummary {
              id: .id,
              name: .name,
              origin: "mock"
            }

            store response -> summary {
              key: .id
            }
          }
        }

        run Fetch then Transform
      }
    `;

    const result = await execute(source, { verbose: false });

    expect(result.success).toBe(true);
    expect(result.actionsRun).toEqual(['Fetch', 'Transform']);

    const summary = await result.stores.get('summary')!.list();
    expect(summary).toHaveLength(2);
    expect(summary[0]).toHaveProperty('origin', 'mock');
    // Mapped shape drops fields not named in the map projection.
    expect(summary[0]).not.toHaveProperty('email');
  });

  it('surfaces a non-2xx response as a failed execution', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    );

    const source = `
      mission FetchUsers {
        source Api {
          auth: none,
          base: "https://api.example.test"
        }

        store users: memory("users")

        action Fetch {
          get "/users"
          store response -> users {
            key: .id
          }
        }

        run Fetch
      }
    `;

    const result = await execute(source, { verbose: false });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('sends an Idempotency-Key on mutating fetches in durable mode (executionLog set)', async () => {
    const fetchMock = stubTransport({ '/orders': { ok: true } });
    const source = `
      mission Order {
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Place {
          post "/orders"
          store response -> out { key: "r" }
        }
        run Place
      }
    `;

    await execute(source, { verbose: false, executionLog: new MemoryExecutionLog() });

    const init = fetchMock.mock.calls.find((c) => String(c[0]).includes('/orders'))?.[1] as
      RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBeTypeOf('string');
  });

  it('sends no Idempotency-Key when no execution log is configured', async () => {
    const fetchMock = stubTransport({ '/orders': { ok: true } });
    const source = `
      mission Order {
        source Api { auth: none, base: "https://api.example.test" }
        store out: memory("out")
        action Place {
          post "/orders"
          store response -> out { key: "r" }
        }
        run Place
      }
    `;

    await execute(source, { verbose: false });

    const init = fetchMock.mock.calls.find((c) => String(c[0]).includes('/orders'))?.[1] as
      RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBeUndefined();
  });
});
