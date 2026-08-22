import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MissionExecutor } from './executor.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';

const MISSION = `
  mission BulkFetch {
    source API {
      auth: none,
      base: "https://api.example.com",
      proxy: [env("TEST_EGRESS_A"), env("TEST_EGRESS_B")],
      rateLimit: { strategy: throttle, fallbackRpm: 60000 }
    }

    store ids: memory("ids")
    store entries: memory("entries")

    action LoadIds {
      get "/ids"
      store response -> ids { key: .id }
    }

    action FetchEach {
      for row in ids concurrency 4 {
        get "/entry/{row.id}"
        store response -> entries { key: .id, upsert: true }
      }
    }

    run LoadIds then FetchEach
  }
`;

/**
 * End-to-end cover for the sharded bulk-fetch shape: a source rotating egress
 * across a proxy pool, driven by a concurrent for loop.
 */
describe('sharded bulk fetch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.TEST_EGRESS_A = 'http://a.internal:3128';
    process.env.TEST_EGRESS_B = 'http://b.internal:3128';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_EGRESS_A;
    delete process.env.TEST_EGRESS_B;
  });

  /** Stubs the API and reports what egress each entry request used. */
  function stubApi(idCount: number) {
    const entryCalls: Array<{ url: string; dispatcher: unknown }> = [];
    let inFlight = 0;
    let peak = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const dispatcher = (init as { dispatcher?: unknown } | undefined)?.dispatcher;

      if (url.endsWith('/ids')) {
        const ids = Array.from({ length: idCount }, (_, i) => ({ id: i + 1 }));
        return new Response(JSON.stringify(ids), { status: 200 });
      }

      entryCalls.push({ url, dispatcher });
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;

      const id = Number(url.split('/').pop());
      return new Response(JSON.stringify({ id, name: `entry-${id}` }), { status: 200 });
    }) as typeof globalThis.fetch;

    return { entryCalls, peak: () => peak };
  }

  async function runMission() {
    const program = new ReqonParser(new ReqonLexer(MISSION).tokenize()).parse();
    // These tests observe the dispatcher through a stubbed global fetch, so the
    // pool must not reach for undici's own fetch (see ProxyLane.fetchImpl).
    return new MissionExecutor({
      proxyAgentFactory: async (url) => ({ proxy: url }),
      proxyFetchFactory: async () => undefined,
    }).execute(program);
  }

  it('fetches every id, overlapping up to the declared concurrency', async () => {
    const api = stubApi(12);

    const result = await runMission();

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(api.entryCalls).toHaveLength(12);
    expect(api.peak()).toBeGreaterThan(1);
    expect(api.peak()).toBeLessThanOrEqual(4);
  });

  it('routes every request through the proxy pool', async () => {
    const api = stubApi(12);

    await runMission();

    expect(api.entryCalls.every((c) => c.dispatcher !== undefined)).toBe(true);
  });

  it('spreads requests across both proxies rather than pinning one', async () => {
    const api = stubApi(12);

    await runMission();

    const distinct = new Set(api.entryCalls.map((c) => c.dispatcher));
    expect(distinct.size).toBe(2);
  });

  it('stores every fetched entry', async () => {
    stubApi(12);

    const result = await runMission();

    expect(await result.stores.get('entries')?.list()).toHaveLength(12);
  });
});
