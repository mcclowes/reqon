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

import type { SourceDefinition } from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import { HttpClient, BearerAuthProvider, OAuth2AuthProvider, type AuthProvider } from './http.js';
import { loadOAS, type OASSource } from '../oas/index.js';
import type { RateLimiter } from '../auth/types.js';
import type { CircuitBreaker } from '../auth/circuit-breaker.js';

export interface AuthConfig {
  type: 'bearer' | 'oauth2' | 'none';
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface SourceManagerConfig {
  /** Auth configurations by source name */
  auth?: Record<string, AuthConfig>;
  /** Logging function */
  log?: (message: string) => void;
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

    const client = new HttpClient({
      baseUrl,
      auth: authProvider,
      rateLimiter: this.deps.rateLimiter,
      circuitBreaker: this.deps.circuitBreaker,
      sourceName: source.name,
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

    return undefined;
  }

  private async resolveBaseUrl(source: SourceDefinition): Promise<string> {
    let baseUrl = source.config.base;

    // If source has OAS spec, load it
    if (source.specPath) {
      try {
        const oasSource = await loadOAS(source.specPath);
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
      throw new Error(`Source ${source.name} has no base URL (provide 'base' or OAS spec with servers)`);
    }

    return baseUrl;
  }

  private configureRateLimiter(source: SourceDefinition): void {
    if (!source.config.rateLimit) {
      return;
    }

    this.deps.rateLimiter.configure(source.name, {
      strategy: source.config.rateLimit.strategy,
      maxWait: source.config.rateLimit.maxWait,
      fallbackRpm: source.config.rateLimit.fallbackRpm,
    });

    this.log(
      `Rate limit config for ${source.name}: strategy=${source.config.rateLimit.strategy ?? 'pause'}, ` +
        `maxWait=${source.config.rateLimit.maxWait ?? 300}s`
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
    });

    this.log(
      `Circuit breaker config for ${source.name}: ` +
        `failureThreshold=${source.config.circuitBreaker.failureThreshold ?? 5}, ` +
        `resetTimeout=${source.config.circuitBreaker.resetTimeout ?? 30}s`
    );
  }

  private log(message: string): void {
    this.config.log?.(message);
  }
}
