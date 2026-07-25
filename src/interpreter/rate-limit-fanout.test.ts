import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MissionExecutor } from './executor.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';

/**
 * Does a concurrent fan-out actually stay under an API's rate limit?
 *
 * The stub here enforces a real per-IP budget and answers 429 when it's
 * exceeded, so these tests measure the property we care about directly - the
 * count of 429s the server chose to send - rather than asserting on the
 * limiter's internal bookkeeping.
 *
 * Every request goes to a distinct interpolated path, which is the case that
 * matters: per-path resilience state makes each request look like the first one
 * and the throttle never engages.
 */

const ID_COUNT = 24;

/** Mission text with a configurable rateLimit block and optional proxy pool. */
function mission(rateLimit: string, proxies?: string[]): string {
  const proxyLine = proxies ? `proxy: [${proxies.map((p) => `"${p}"`).join(', ')}],` : '';
  return `
    mission BulkFetch {
      source API {
        auth: none,
        base: "https://api.example.com",
        ${proxyLine}
        rateLimit: { ${rateLimit} }
      }

      store ids: memory("ids")
      store entries: memory("entries")

      action LoadIds {
        get "/ids"
        store response -> ids { key: .id }
      }

      action FetchEach {
        for row in ids concurrency 8 {
          get "/entry/{row.id}/history"
          store response -> entries { key: .id, upsert: true }
        }
      }

      run LoadIds then FetchEach
    }
  `;
}

/**
 * An API that enforces `limit` requests per rolling `windowMs`, per egress.
 * Egress is identified by the undici dispatcher the client attached, which is
 * how a real per-IP limit would see a proxy pool.
 */
function stubEnforcingApi(limit: number, windowMs: number) {
  const hitsByLane = new Map<unknown, number[]>();
  let rejected = 0;
  let served = 0;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.endsWith('/ids')) {
      const ids = Array.from({ length: ID_COUNT }, (_, i) => ({ id: i + 1 }));
      return new Response(JSON.stringify(ids), { status: 200 });
    }

    const lane = (init as { dispatcher?: unknown } | undefined)?.dispatcher ?? 'direct';
    const now = Date.now();
    const hits = hitsByLane.get(lane) ?? [];
    while (hits.length > 0 && hits[0] <= now - windowMs) hits.shift();

    if (hits.length >= limit) {
      hitsByLane.set(lane, hits);
      rejected++;
      return new Response('{"error":"too many requests"}', {
        status: 429,
        headers: { 'Retry-After': '1' },
      });
    }

    hits.push(now);
    hitsByLane.set(lane, hits);
    served++;

    const id = Number(url.split('/').slice(-2, -1)[0]);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }) as typeof globalThis.fetch;

  return {
    rejected: () => rejected,
    served: () => served,
    lanes: () => hitsByLane.size,
  };
}

async function runMission(text: string) {
  const program = new ReqonParser(new ReqonLexer(text).tokenize()).parse();
  // Egress is identified by the dispatcher the stubbed fetch receives, so keep
  // the pool off undici's real fetch (see ProxyLane.fetchImpl).
  return new MissionExecutor({
    proxyAgentFactory: async (url) => ({ proxy: url }),
    proxyFetchFactory: async () => undefined,
  }).execute(program);
}

describe('rate limited fan-out', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Control case. If this ever stops seeing 429s the stub has gone toothless
  // and the assertions below would pass without proving anything.
  it('gets 429s when nothing paces the fan-out', async () => {
    const api = stubEnforcingApi(6, 1000);

    // maxAttempts 1 so retries don't quietly launder the rejections away.
    await runMission(mission('strategy: pause, fallbackRpm: 60000'));

    expect(api.rejected()).toBeGreaterThan(0);
  });

  it('takes zero 429s when throttled below the limit', async () => {
    // Server allows 20 per 500ms (40/s). Client paces to 20/s - half the
    // budget, enough margin to absorb timer jitter.
    const api = stubEnforcingApi(20, 500);

    const result = await runMission(mission('strategy: throttle, fallbackRpm: 1200'));

    expect(result.errors).toEqual([]);
    expect(api.rejected()).toBe(0);
    expect(api.served()).toBe(ID_COUNT);
  });

  it('paces the run at the configured rate rather than bursting', async () => {
    stubEnforcingApi(1000, 500);

    const start = Date.now();
    await runMission(mission('strategy: throttle, fallbackRpm: 1200'));
    const elapsed = Date.now() - start;

    // 24 entry requests at 50ms apart. The first is free, so >= 23 gaps.
    expect(elapsed).toBeGreaterThanOrEqual(23 * 50);
  });

  it('gives each proxy its own budget instead of sharing one', async () => {
    // Each egress may serve 8 per 500ms. One shared budget would blow that;
    // four independent ones stay inside it.
    const api = stubEnforcingApi(8, 500);

    const result = await runMission(
      mission('strategy: throttle, fallbackRpm: 600', [
        'http://a.internal:3128',
        'http://b.internal:3128',
        'http://c.internal:3128',
        'http://d.internal:3128',
      ])
    );

    expect(result.errors).toEqual([]);
    expect(api.lanes()).toBe(4);
    expect(api.rejected()).toBe(0);
  });
});
