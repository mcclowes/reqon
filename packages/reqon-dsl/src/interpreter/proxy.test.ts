import { describe, it, expect, vi } from 'vitest';
import { ProxyPool, proxyLabel } from './proxy.js';

describe('proxyLabel', () => {
  it('reduces a proxy URL to host:port', () => {
    expect(proxyLabel('http://proxy.internal:3128')).toBe('proxy.internal:3128');
  });

  it('strips credentials so they never reach a limiter key or log line', () => {
    expect(proxyLabel('http://user:hunter2@proxy.internal:3128')).toBe('proxy.internal:3128');
  });

  it('rejects a URL that is not a valid proxy', () => {
    expect(() => proxyLabel('not-a-url')).toThrow(/invalid proxy URL/i);
  });
});

describe('ProxyPool', () => {
  const fakeAgents = () => vi.fn(async (url: string) => ({ agentFor: url }));

  it('rotates round-robin across the pool', async () => {
    const pool = new ProxyPool(['http://a:3128', 'http://b:3128'], { agentFactory: fakeAgents() });

    const labels = [
      (await pool.acquire()).label,
      (await pool.acquire()).label,
      (await pool.acquire()).label,
    ];

    expect(labels).toEqual(['a:3128', 'b:3128', 'a:3128']);
  });

  it('hands back the dispatcher for the chosen proxy', async () => {
    const pool = new ProxyPool(['http://a:3128'], { agentFactory: fakeAgents() });

    expect((await pool.acquire()).dispatcher).toEqual({ agentFor: 'http://a:3128' });
  });

  it('builds one dispatcher per proxy and reuses it', async () => {
    const agentFactory = fakeAgents();
    const pool = new ProxyPool(['http://a:3128', 'http://b:3128'], { agentFactory });

    for (let i = 0; i < 6; i++) await pool.acquire();

    expect(agentFactory).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty pool at construction', () => {
    expect(() => new ProxyPool([], { agentFactory: fakeAgents() })).toThrow(/at least one/i);
  });

  it('rejects a malformed proxy URL at construction, not mid-run', () => {
    expect(() => new ProxyPool(['http://a:3128', 'nope'], { agentFactory: fakeAgents() })).toThrow(
      /invalid proxy URL/i
    );
  });

  it('builds a real undici dispatcher when no factory is injected', async () => {
    const pool = new ProxyPool(['http://a:3128']);

    const lane = await pool.acquire();

    expect(lane.label).toBe('a:3128');
    // undici's ProxyAgent is a Dispatcher: it exposes dispatch/close.
    expect(typeof (lane.dispatcher as { dispatch?: unknown }).dispatch).toBe('function');

    await pool.close();
  });

  it('retries dispatcher construction after a failure instead of caching it', async () => {
    let calls = 0;
    const pool = new ProxyPool(['http://a:3128'], {
      agentFactory: async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
        return { ok: true };
      },
    });

    await expect(pool.acquire()).rejects.toThrow('transient');
    expect((await pool.acquire()).dispatcher).toEqual({ ok: true });
  });
});
