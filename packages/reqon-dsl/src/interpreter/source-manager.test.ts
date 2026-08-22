import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SourceManager, type AuthConfig } from './source-manager.js';
import { createContext } from './context.js';
import { AdaptiveRateLimiter } from '../auth/rate-limiter.js';
import { CircuitBreaker } from '../auth/circuit-breaker.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';
import type { SourceDefinition } from '../ast/nodes.js';

function sourceFrom(config: string): SourceDefinition {
  const lexer = new ReqonLexer(`
    mission M {
      source API {
        auth: none,
        base: "https://api.example.com",
        ${config}
      }
      store items: memory("items")
      action A { get "/items" }
      run A
    }
  `);
  const mission = new ReqonParser(lexer.tokenize()).parse().statements[0];
  if (mission.type !== 'MissionDefinition') throw new Error('Expected a mission');
  return mission.sources[0];
}

describe('SourceManager proxy wiring', () => {
  let manager: SourceManager;

  beforeEach(() => {
    manager = new SourceManager(
      {},
      { rateLimiter: new AdaptiveRateLimiter(), circuitBreaker: new CircuitBreaker() }
    );
  });

  afterEach(() => {
    delete process.env.TEST_PROXY_A;
    delete process.env.TEST_PROXY_B;
  });

  it('resolves env-backed proxy entries into a pool at mission start', async () => {
    process.env.TEST_PROXY_A = 'http://a.internal:3128';
    process.env.TEST_PROXY_B = 'http://b.internal:3128';
    const ctx = createContext();

    await manager.initializeSource(
      sourceFrom(`proxy: [env("TEST_PROXY_A"), env("TEST_PROXY_B")]`),
      ctx
    );

    expect(manager.getProxyPool('API')?.poolLabels).toEqual(['a.internal:3128', 'b.internal:3128']);
  });

  it('builds no pool for a source without a proxy', async () => {
    const ctx = createContext();

    await manager.initializeSource(sourceFrom(`rateLimit: { fallbackRpm: 30 }`), ctx);

    expect(manager.getProxyPool('API')).toBeUndefined();
  });

  it('fails loudly when a proxy env var is unset rather than shrinking the pool', async () => {
    process.env.TEST_PROXY_A = 'http://a.internal:3128';
    const ctx = createContext();

    await expect(
      manager.initializeSource(sourceFrom(`proxy: [env("TEST_PROXY_A"), env("TEST_PROXY_B")]`), ctx)
    ).rejects.toThrow(/API.*proxy.*\[1\].*empty/i);
  });
});

describe('SourceManager circuit breaker logging', () => {
  const logFor = async (config: string): Promise<string> => {
    const lines: string[] = [];
    const manager = new SourceManager(
      { log: (message) => lines.push(message) },
      { rateLimiter: new AdaptiveRateLimiter(), circuitBreaker: new CircuitBreaker() }
    );
    await manager.initializeSource(sourceFrom(config), createContext());
    return lines.find((line) => line.startsWith('Circuit breaker config')) ?? '';
  };

  it('reports rate mode rather than an absolute threshold it was never given', async () => {
    const line = await logFor(
      `circuitBreaker: { failureRate: 0.25, minimumRequests: 50, resetTimeout: 120 }`
    );

    expect(line).toContain('failureRate=0.25');
    expect(line).toContain('minimumRequests=50');
    expect(line).not.toContain('failureThreshold');
  });

  it('still reports an absolute threshold when that is what was configured', async () => {
    const line = await logFor(`circuitBreaker: { failureThreshold: 5, resetTimeout: 120 }`);

    expect(line).toContain('failureThreshold=5');
    expect(line).not.toContain('failureRate');
  });
});

describe('SourceManager auth providers (#200)', () => {
  const build = (auth: AuthConfig): SourceManager =>
    new SourceManager(
      { auth: { API: auth } },
      { rateLimiter: new AdaptiveRateLimiter(), circuitBreaker: new CircuitBreaker() }
    );

  const headersFor = async (auth: AuthConfig): Promise<Record<string, string>> => {
    const ctx = createContext();
    await build(auth).initializeSource(sourceFrom(`rateLimit: { fallbackRpm: 60 }`), ctx);
    const client = ctx.sources.get('API')!;
    let headers: Record<string, string> = {};
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers = Object.fromEntries(Object.entries(init?.headers || {}));
      return new Response('{}', { status: 200 });
    });
    try {
      await client.request({ method: 'GET', path: '/items' });
    } finally {
      globalThis.fetch = original;
    }
    return headers;
  };

  it('wires basic auth so requests carry an Authorization: Basic header', async () => {
    const headers = await headersFor({ type: 'basic', username: 'alice', password: 'secret' });
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('alice:secret').toString('base64')}`
    );
  });

  it('wires api_key auth so requests carry the key header', async () => {
    const headers = await headersFor({ type: 'api_key', apiKey: 'k-1', headerName: 'X-Api-Key' });
    expect(headers['X-Api-Key']).toBe('k-1');
  });

  it('refuses to run (throws) when basic credentials are incomplete', async () => {
    await expect(
      build({ type: 'basic', username: 'alice' }).initializeSource(
        sourceFrom(`rateLimit: { fallbackRpm: 60 }`),
        createContext()
      )
    ).rejects.toThrow(/basic auth requires/);
  });

  it('refuses to run (throws) when the api_key value is missing', async () => {
    await expect(
      build({ type: 'api_key' }).initializeSource(
        sourceFrom(`rateLimit: { fallbackRpm: 60 }`),
        createContext()
      )
    ).rejects.toThrow(/api_key auth requires/);
  });

  it('refuses to run (throws) when bearer is configured without a token', async () => {
    await expect(
      build({ type: 'bearer' }).initializeSource(
        sourceFrom(`rateLimit: { fallbackRpm: 60 }`),
        createContext()
      )
    ).rejects.toThrow(/Refusing to send an unauthenticated request/);
  });
});
