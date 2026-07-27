/**
 * SourceManager handles HTTP source initialization and configuration.
 *
 * Extracted from MissionExecutor to improve separation of concerns.
 * Responsible for:
 * - Creating HTTP clients for sources
 * - Configuring authentication providers
 * - Loading and caching OAS specs
 * - Configuring rate limiters and circuit breakers per source
 */

import { resolve } from 'node:path';
import type { SourceDefinition } from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import {
  HttpClient,
  BearerAuthProvider,
  OAuth2AuthProvider,
  BasicAuthProvider,
  ApiKeyAuthProvider,
  type AuthProvider,
  type RetryInfo,
} from './http.js';
import { loadOAS, type OASSource } from '../oas/index.js';
import type { RateLimiter } from '../auth/types.js';
import type { CircuitBreaker } from '../auth/circuit-breaker.js';
import { ProxyPool, type ProxyAgentFactory } from './proxy.js';
import { evaluate } from './evaluator.js';

export interface AuthConfig {
  type: 'bearer' | 'oauth2' | 'basic' | 'api_key' | 'none';
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  /** API key value (type: api_key) */
  apiKey?: string;
  /** Header or query param name carrying the API key (type: api_key) */
  headerName?: string;
  /** Where the API key travels (type: api_key). Default: 'header'. */
  apiKeyLocation?: 'header' | 'query';
  /** Username (type: basic) */
  username?: string;
  /** Password (type: basic) */
  password?: string;
}

export interface SourceManagerConfig {
  /** Auth configurations by source name */
  auth?: Record<string, AuthConfig>;
  /** Logging function */
  log?: (message: string) => void;
  /** Mission file directory for resolving relative paths */
  missionDir?: string;
  /**
   * Supply the HTTP stack behind proxy pools. Proxied requests are dispatched
   * through the fetch paired with the agent (see ProxyLane.fetchImpl), so these
   * two travel together: override both, or neither.
   */
  proxyAgentFactory?: ProxyAgentFactory;
  proxyFetchFactory?: () => Promise<typeof globalThis.fetch | undefined>;
  /** Notified before each HTTP retry backoff (for observability / progress). */
  onRetry?: (info: RetryInfo) => void;
}

export interface SourceManagerDeps {
  rateLimiter: RateLimiter;
  circuitBreaker: CircuitBreaker;
}

/**
 * Manages HTTP source initialization and provides access to source configurations.
 */
export class SourceManager {
  private oasSources: Map<string, OASSource> = new Map();
  private sourceConfigs: Map<string, SourceDefinition> = new Map();
  private proxyPools: Map<string, ProxyPool> = new Map();
  private config: SourceManagerConfig;
  private deps: SourceManagerDeps;

  constructor(config: SourceManagerConfig, deps: SourceManagerDeps) {
    this.config = config;
    this.deps = deps;
  }

  /**
   * Initialize a source definition, creating the HTTP client and configuring resilience.
   */
  async initializeSource(source: SourceDefinition, ctx: ExecutionContext): Promise<void> {
    // Store source config for later reference
    this.sourceConfigs.set(source.name, source);

    const authProvider = this.createAuthProvider(source.name);
    const baseUrl = await this.resolveBaseUrl(source);

    this.configureRateLimiter(source);
    this.configureCircuitBreaker(source);
    const proxyPool = this.buildProxyPool(source, ctx);

    const client = new HttpClient({
      baseUrl,
      auth: authProvider,
      rateLimiter: this.deps.rateLimiter,
      circuitBreaker: this.deps.circuitBreaker,
      sourceName: source.name,
      proxyPool,
      onRetry: this.config.onRetry,
    });

    ctx.sources.set(source.name, client);
    this.log(`Initialized source: ${source.name}`);
  }

  /**
   * Initialize multiple sources.
   */
  async initializeSources(sources: SourceDefinition[], ctx: ExecutionContext): Promise<void> {
    for (const source of sources) {
      await this.initializeSource(source, ctx);
    }
  }

  /**
   * Get the OAS source for a given source name.
   */
  getOASSource(sourceName: string): OASSource | undefined {
    return this.oasSources.get(sourceName);
  }

  /**
   * Get the source configuration for a given source name.
   */
  getSourceConfig(sourceName: string): SourceDefinition | undefined {
    return this.sourceConfigs.get(sourceName);
  }

  /**
   * Get the egress proxy pool for a source, if it declared one.
   */
  getProxyPool(sourceName: string): ProxyPool | undefined {
    return this.proxyPools.get(sourceName);
  }

  /**
   * Close every proxy pool, releasing pooled sockets at end of run.
   */
  async closeProxyPools(): Promise<void> {
    const pools = Array.from(this.proxyPools.values());
    this.proxyPools.clear();
    await Promise.all(pools.map((pool) => pool.close()));
  }

  /**
   * Resolve a source's `proxy` expressions into a pool.
   *
   * A *partially* unset pool is a hard error rather than a silently shorter
   * pool. Quietly dropping proxies would concentrate the run's whole request
   * rate onto the survivors, which is the exact failure the pool exists to
   * prevent.
   *
   * Every entry unset is a different statement: no proxies are configured, so
   * the mission runs direct. That keeps a proxy-capable mission runnable
   * without a proxy provider, and there is no pool to overload. It is logged
   * loudly because it means requests leave from this host's own address.
   */
  private buildProxyPool(source: SourceDefinition, ctx: ExecutionContext): ProxyPool | undefined {
    const entries = source.config.proxy;
    if (!entries?.length) return undefined;

    const resolved = entries.map((expr) => {
      const value = evaluate(expr, ctx);
      return typeof value === 'string' ? value.trim() : '';
    });

    if (resolved.every((url) => !url)) {
      this.log(
        `Source ${source.name}: no proxies resolved (${resolved.length} configured), ` +
          'sending requests direct. Set the proxy environment variables to use the pool.'
      );
      return undefined;
    }

    const urls = resolved.map((url, index) => {
      if (!url) {
        throw new Error(
          `Source ${source.name}: proxy[${index}] resolved to an empty value. ` +
            'Set the environment variable, or remove the entry from the pool.'
        );
      }
      return url;
    });

    const pool = new ProxyPool(urls, {
      agentFactory: this.config.proxyAgentFactory,
      fetchFactory: this.config.proxyFetchFactory,
    });
    this.proxyPools.set(source.name, pool);
    this.log(`Proxy pool for ${source.name}: ${pool.poolLabels.join(', ')}`);
    return pool;
  }

  /**
   * Get all OAS sources.
   */
  getAllOASSources(): Map<string, OASSource> {
    return this.oasSources;
  }

  /**
   * Get all source configurations.
   */
  getAllSourceConfigs(): Map<string, SourceDefinition> {
    return this.sourceConfigs;
  }

  private createAuthProvider(sourceName: string): AuthProvider | undefined {
    const authConfig = this.config.auth?.[sourceName];
    if (!authConfig) {
      return undefined;
    }

    if (authConfig.type === 'bearer' && authConfig.token) {
      return new BearerAuthProvider(authConfig.token);
    }

    if (authConfig.type === 'oauth2' && authConfig.accessToken) {
      return new OAuth2AuthProvider({
        accessToken: authConfig.accessToken,
        refreshToken: authConfig.refreshToken,
        tokenEndpoint: authConfig.tokenEndpoint,
        clientId: authConfig.clientId,
        clientSecret: authConfig.clientSecret,
      });
    }

    if (authConfig.type === 'basic') {
      if (!authConfig.username || authConfig.password === undefined) {
        throw new Error(
          `Source '${sourceName}': basic auth requires 'username' and 'password'. ` +
            `Set REQON_${sourceName.toUpperCase()}_USERNAME and _PASSWORD, or the auth config equivalents.`
        );
      }
      return new BasicAuthProvider(authConfig.username, authConfig.password);
    }

    if (authConfig.type === 'api_key') {
      if (!authConfig.apiKey) {
        throw new Error(
          `Source '${sourceName}': api_key auth requires 'apiKey'. ` +
            `Set REQON_${sourceName.toUpperCase()}_API_KEY, or the auth config equivalent.`
        );
      }
      return new ApiKeyAuthProvider(authConfig.apiKey, {
        name: authConfig.headerName,
        location: authConfig.apiKeyLocation,
      });
    }

    if (authConfig.type === 'none') {
      return undefined;
    }

    // A configured-but-unhandled auth type (or one missing its credentials, e.g.
    // bearer with no token) must fail loudly rather than fall through to an
    // unauthenticated request — the exact silent-drop #200 was about. `none` and
    // the fully-populated cases above are the only ways to reach a request
    // without an Authorization contribution.
    throw new Error(
      `Source '${sourceName}': auth type '${authConfig.type}' is configured but its ` +
        `credentials are missing or the type is unsupported. Refusing to send an ` +
        `unauthenticated request. Provide the required credentials or set auth to 'none'.`
    );
  }

  private async resolveBaseUrl(source: SourceDefinition): Promise<string> {
    let baseUrl = source.config.base;

    // If source has OAS spec, load it
    if (source.specPath) {
      try {
        // Resolve relative spec paths against mission directory
        const specPath = this.config.missionDir
          ? resolve(this.config.missionDir, source.specPath)
          : source.specPath;
        const oasSource = await loadOAS(specPath);
        this.oasSources.set(source.name, oasSource);
        // Use base URL from OAS if not explicitly provided
        if (!baseUrl) {
          baseUrl = oasSource.baseUrl;
        }
        this.log(`Loaded OAS spec for ${source.name}: ${oasSource.operations.size} operations`);
      } catch (error) {
        throw new Error(`Failed to load OAS spec for ${source.name}: ${(error as Error).message}`);
      }
    }

    if (!baseUrl) {
      throw new Error(
        `Source ${source.name} has no base URL (provide 'base' or OAS spec with servers)`
      );
    }

    return baseUrl;
  }

  private configureRateLimiter(source: SourceDefinition): void {
    if (!source.config.rateLimit) {
      return;
    }

    const { strategy, maxWait, fallbackRpm, model } = source.config.rateLimit;
    this.deps.rateLimiter.configure(source.name, { strategy, maxWait, fallbackRpm, model });

    const modelInfo = model
      ? `, model=${model.type}(capacity ${model.capacity}, refill ${model.refill}/s)`
      : '';
    this.log(
      `Rate limit config for ${source.name}: strategy=${strategy ?? 'pause'}, ` +
        `maxWait=${maxWait ?? 300}s${modelInfo}`
    );
  }

  private configureCircuitBreaker(source: SourceDefinition): void {
    if (!source.config.circuitBreaker) {
      return;
    }

    this.deps.circuitBreaker.configure(source.name, {
      failureThreshold: source.config.circuitBreaker.failureThreshold,
      // Convert seconds to milliseconds for the circuit breaker
      resetTimeout: source.config.circuitBreaker.resetTimeout
        ? source.config.circuitBreaker.resetTimeout * 1000
        : undefined,
      successThreshold: source.config.circuitBreaker.successThreshold,
      failureWindow: source.config.circuitBreaker.failureWindow
        ? source.config.circuitBreaker.failureWindow * 1000
        : undefined,
      failureRate: source.config.circuitBreaker.failureRate,
      minimumRequests: source.config.circuitBreaker.minimumRequests,
    });

    // Report the mode actually in effect. Rate mode leaves failureThreshold
    // unset, so printing its default reads as an absolute threshold of 5 - the
    // exact setting `failureRate` exists to replace at high request volumes.
    const { failureRate, minimumRequests, failureThreshold, resetTimeout } =
      source.config.circuitBreaker;
    const trip =
      failureRate !== undefined
        ? `failureRate=${failureRate}, minimumRequests=${minimumRequests ?? 10}`
        : `failureThreshold=${failureThreshold ?? 5}`;

    this.log(
      `Circuit breaker config for ${source.name}: ${trip}, resetTimeout=${resetTimeout ?? 30}s`
    );
  }

  private log(message: string): void {
    this.config.log?.(message);
  }
}
