/**
 * ---
 * purpose: Egress proxy pool - rotates a source's requests across proxy URLs
 * exports:
 *   - ProxyPool - round-robin pool with a cached dispatcher per proxy
 *   - proxyLabel - credential-free host:port label for a proxy URL
 * related:
 *   - ./http.ts - picks a lane per request attempt and dispatches through it
 *   - ./source-manager.ts - builds the pool from a source's `proxy` config
 * ---
 */

/** A chosen egress lane: which proxy, and the dispatcher that routes through it. */
export interface ProxyLane {
  /** Credential-free `host:port`, safe for limiter keys, logs, and events. */
  label: string;
  /** undici Dispatcher, passed to fetch as the `dispatcher` option. */
  dispatcher: unknown;
}

export type ProxyAgentFactory = (proxyUrl: string) => Promise<unknown>;

/**
 * Reduce a proxy URL to `host:port`.
 *
 * Proxy URLs routinely carry credentials (`http://user:pass@host:3128`). This
 * label is what ends up in rate-limiter keys, circuit-breaker keys, and log
 * lines, so it must never carry the userinfo component.
 */
export function proxyLabel(proxyUrl: string): string {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    throw new Error(`Invalid proxy URL: ${proxyUrl}`);
  }
  if (!url.host) throw new Error(`Invalid proxy URL: ${proxyUrl}`);
  return url.host;
}

/**
 * Load undici on demand. Kept an optional peer dependency so the vast majority
 * of missions, which never touch a proxy, don't pay for it. The non-literal
 * specifier keeps the import out of the compiler's resolution graph.
 */
const defaultAgentFactory: ProxyAgentFactory = async (proxyUrl) => {
  let ProxyAgent: new (uri: string) => unknown;
  try {
    const specifier = 'undici';
    const mod = (await import(specifier)) as {
      ProxyAgent?: new (uri: string) => unknown;
      default?: { ProxyAgent?: new (uri: string) => unknown };
    };
    const ctor = mod.ProxyAgent ?? mod.default?.ProxyAgent;
    if (!ctor) throw new Error('undici.ProxyAgent not found');
    ProxyAgent = ctor;
  } catch {
    throw new Error(
      "Proxy support requires the optional peer dependency 'undici'. " +
        'Install it with: npm install undici'
    );
  }
  return new ProxyAgent(proxyUrl);
};

/**
 * Round-robin pool of egress proxies for one source.
 *
 * Rotation is per acquire, which means per request attempt: a retry after a 429
 * leaves from a different IP than the attempt that earned it. Dispatchers are
 * built lazily and cached, so each proxy keeps one connection pool for the life
 * of the run.
 */
export class ProxyPool {
  private readonly urls: string[];
  private readonly labels: string[];
  private readonly agentFactory: ProxyAgentFactory;
  private readonly dispatchers = new Map<string, Promise<unknown>>();
  private cursor = 0;

  constructor(urls: string[], options: { agentFactory?: ProxyAgentFactory } = {}) {
    if (urls.length === 0) throw new Error('Proxy pool needs at least one proxy URL');
    // Validate up front so a typo in the fifth proxy fails at mission start
    // rather than thousands of requests into a run.
    this.labels = urls.map(proxyLabel);
    this.urls = urls;
    this.agentFactory = options.agentFactory ?? defaultAgentFactory;
  }

  get size(): number {
    return this.urls.length;
  }

  /** All proxy labels, in rotation order. */
  get poolLabels(): readonly string[] {
    return this.labels;
  }

  async acquire(): Promise<ProxyLane> {
    const index = this.cursor % this.urls.length;
    this.cursor = (this.cursor + 1) % this.urls.length;
    const url = this.urls[index];

    let dispatcher = this.dispatchers.get(url);
    if (!dispatcher) {
      dispatcher = this.agentFactory(url);
      this.dispatchers.set(url, dispatcher);
    }

    try {
      return { label: this.labels[index], dispatcher: await dispatcher };
    } catch (error) {
      // Don't cache a failed construction - a later attempt should retry it.
      this.dispatchers.delete(url);
      throw error;
    }
  }

  /** Close every dispatcher, releasing pooled sockets. */
  async close(): Promise<void> {
    const pending = Array.from(this.dispatchers.values());
    this.dispatchers.clear();
    await Promise.all(
      pending.map(async (entry) => {
        const dispatcher = (await entry.catch(() => undefined)) as
          { close?: () => Promise<void> } | undefined;
        await dispatcher?.close?.().catch(() => undefined);
      })
    );
  }
}
