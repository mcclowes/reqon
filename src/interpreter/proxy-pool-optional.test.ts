import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SourceManager } from './source-manager.js';
import { createContext } from './context.js';
import { AdaptiveRateLimiter } from '../auth/rate-limiter.js';
import { CircuitBreaker } from '../auth/circuit-breaker.js';
import type { SourceDefinition } from '../ast/nodes.js';
import type { Expression } from 'vague-lang';

/**
 * A pool whose entries are all unset means "no proxies configured" - the
 * example should run direct rather than refusing to start. A partially unset
 * pool stays a hard error: quietly dropping proxies concentrates the whole
 * request rate onto the survivors, which is what the pool exists to prevent.
 */
describe('optional proxy pool', () => {
  const envCall = (name: string): Expression =>
    ({
      type: 'CallExpression',
      callee: 'env',
      arguments: [{ type: 'Literal', value: name, dataType: 'string' }],
    }) as unknown as Expression;

  const sourceWithProxies = (names: string[]): SourceDefinition =>
    ({
      name: 'FPL',
      config: {
        auth: { type: 'none' },
        base: 'https://example.test',
        proxy: names.map(envCall),
      },
    }) as unknown as SourceDefinition;

  const VARS = ['PROXY_A', 'PROXY_B'];

  const newManager = (): SourceManager =>
    new SourceManager(
      {},
      { rateLimiter: new AdaptiveRateLimiter(), circuitBreaker: new CircuitBreaker() }
    );

  beforeEach(() => {
    for (const key of VARS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of VARS) delete process.env[key];
  });

  it('runs direct when every proxy entry is unset', async () => {
    const manager = newManager();
    const ctx = createContext();

    await manager.initializeSource(sourceWithProxies(VARS), ctx);

    expect(manager.getProxyPool('FPL')).toBeUndefined();
  });

  it('still fails when only some proxy entries are unset', async () => {
    process.env.PROXY_A = 'http://127.0.0.1:3128';
    const manager = newManager();
    const ctx = createContext();

    await expect(manager.initializeSource(sourceWithProxies(VARS), ctx)).rejects.toThrow(
      /proxy\[1\]/
    );
  });

  it('builds the pool when every entry resolves', async () => {
    process.env.PROXY_A = 'http://127.0.0.1:3128';
    process.env.PROXY_B = 'http://127.0.0.1:3129';
    const manager = newManager();
    const ctx = createContext();

    await manager.initializeSource(sourceWithProxies(VARS), ctx);

    expect(manager.getProxyPool('FPL')?.poolLabels).toHaveLength(2);
  });
});
