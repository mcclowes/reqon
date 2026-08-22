import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MissionExecutor } from './executor.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';

/**
 * Expected non-2xx statuses as data rather than failure.
 *
 * `allow: [404]` on the fetch and `404 ->` in the match are deliberately the
 * same vocabulary: what you allow is what you dispatch on, with no separate
 * schema name to invent and keep in sync.
 */

const MISSING = 7;
const TOTAL = 12;

function stubApi() {
  const calls: string[] = [];

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);

    if (url.endsWith('/ids')) {
      const ids = Array.from({ length: TOTAL }, (_, i) => ({ id: i + 1 }));
      return new Response(JSON.stringify(ids), { status: 200 });
    }

    const id = Number(url.split('/').filter(Boolean).slice(-2, -1)[0]);
    if (id === MISSING) {
      return new Response('{"detail":"Not found."}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id, name: `manager-${id}` }), { status: 200 });
  }) as typeof globalThis.fetch;

  return { calls };
}

async function run(loopBody: string, extra = '') {
  const text = `
    mission AllowStatus {
      source API { auth: none, base: "https://api.example.com" }
      store ids: memory("ids")
      store entries: memory("entries")
      store missing: memory("missing")
      ${extra}

      action LoadIds {
        get "/ids"
        store response -> ids { key: .id }
      }

      action FetchEach {
        for row in ids concurrency 4 {
${loopBody}
        }
      }

      run LoadIds then FetchEach
    }
  `;
  const program = new ReqonParser(new ReqonLexer(text).tokenize()).parse();
  return new MissionExecutor({}).execute(program);
}

describe('allowed response statuses', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not fail the fetch for an allowed status', async () => {
    stubApi();

    const result = await run(`
          get "/entry/{row.id}/history" { allow: [404] }
          store response -> entries { key: row.id, upsert: true }`);

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('dispatches on the status with the same number used to allow it', async () => {
    stubApi();

    const result = await run(`
          get "/entry/{row.id}/history" { allow: [404] }
          match response {
            404 -> skip,
            _ -> continue
          }
          store response -> entries { key: row.id, upsert: true }`);

    expect(result.errors).toEqual([]);
    // The 404 was skipped; every other id stored.
    expect(await result.stores.get('entries')?.list()).toHaveLength(TOTAL - 1);
  });

  it('still fails for a status that was not allowed', async () => {
    stubApi();

    const result = await run(`
          get "/entry/{row.id}/history" { allow: [410] }
          store response -> entries { key: row.id, upsert: true }`);

    // Tolerated by the loop's default onError, but the item did not store.
    expect(await result.stores.get('entries')?.list()).toHaveLength(TOTAL - 1);
  });

  it('does not retry an allowed status', async () => {
    const api = stubApi();

    await run(`
          get "/entry/{row.id}/history" {
            allow: [404],
            retry: { maxAttempts: 4, initialDelay: 1 }
          }`);

    const missingCalls = api.calls.filter((u) => u.includes(`/entry/${MISSING}/`));
    expect(missingCalls).toHaveLength(1);
  });
});
