import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute, FetchError, ExecutionAbortedError } from '../index.js';

/** What a host app needs to run a mission per request: inputs, cancellation, error detail. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const mission = (fetchBlock: string) => `
  mission Host {
    source Api { auth: none, base: "https://api.example.test" }
    store out: memory("out")
    action Pull {
      ${fetchBlock}
      store response -> out { key: .id }
    }
    run Pull
  }
`;

afterEach(() => vi.unstubAllGlobals());

describe('inputs', () => {
  it('reads per-run values with input()', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        urls.push(url.toString());
        return json([{ id: 1 }]);
      })
    );

    const result = await execute(mission('get concat("/users/", input("userId"), "/items")'), {
      inputs: { userId: 'u_42' },
    });

    expect(result.success).toBe(true);
    expect(urls).toEqual(['https://api.example.test/users/u_42/items']);
  });

  it('returns null for an input that was not passed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ id: 1 }]))
    );
    const source = mission('get "/items"').replace(
      'store response -> out { key: .id }',
      'validate response { assume input("missing") == null }\n      store response -> out { key: .id }'
    );

    expect((await execute(source)).success).toBe(true);
  });

  it('rejects a dynamic input name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ id: 1, key: 'userId' }))
    );
    const source = mission('get "/item"').replace(
      'store response -> out { key: .id }',
      'validate response { assume input(response.key) == null }'
    );

    const result = await execute(source, { inputs: { userId: 'secret' } });

    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(' ')).toMatch(/string-literal/);
  });
});

describe('signal', () => {
  it('aborts an in-flight request without retrying and fails the run', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
          setTimeout(() => controller.abort(), 5);
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await execute(
      mission('get "/slow" { retry: { maxAttempts: 3, backoff: constant, initialDelay: 1 } }'),
      { signal: controller.signal }
    );

    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.errors[0].details).toBeInstanceOf(ExecutionAbortedError);
  });

  it('cuts a retry backoff short when aborted', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        setTimeout(() => controller.abort(), 5);
        return json({ error: 'busy' }, 503);
      })
    );

    const started = Date.now();
    const result = await execute(
      mission('get "/busy" { retry: { maxAttempts: 3, backoff: constant, initialDelay: 5000 } }'),
      { signal: controller.signal }
    );

    expect(result.success).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not start when the signal is already aborted', async () => {
    const fetchMock = vi.fn(async () => json([{ id: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await execute(mission('get "/items"'), { signal: AbortSignal.abort() });

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('error detail', () => {
  it('exposes the status and parsed error body on the FetchError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          {
            error: {
              status: 'FAILED_PRECONDITION',
              details: [{ reason: 'EXPIRED_SYNC_TOKEN' }],
              access_token: 'leaked',
            },
          },
          410
        )
      )
    );

    const result = await execute(mission('get "/items"'));

    const error = result.errors[0].details;
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).statusCode).toBe(410);
    expect((error as FetchError).body).toMatchObject({
      error: { status: 'FAILED_PRECONDITION', details: [{ reason: 'EXPIRED_SYNC_TOKEN' }] },
    });
    expect(JSON.stringify((error as FetchError).body)).not.toContain('leaked');
  });

  it('does not parse an oversized error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'x'.repeat(70 * 1024) }, 400))
    );

    const result = await execute(mission('get "/items"'));

    expect((result.errors[0].details as FetchError).body).toBeUndefined();
  });

  it('leaves body undefined for a non-JSON error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 403 }))
    );

    const result = await execute(mission('get "/items"'));

    expect((result.errors[0].details as FetchError).body).toBeUndefined();
  });
});
