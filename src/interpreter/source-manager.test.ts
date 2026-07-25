import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SourceManager } from './source-manager.js';
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
