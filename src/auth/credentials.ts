/**
 * Credentials resolver with dotenv support
 *
 * Supports loading credentials from:
 * - Environment variables (via .env files or process.env)
 * - JSON config files with env var interpolation
 *
 * Env var reference patterns:
 * - $VAR_NAME
 * - ${VAR_NAME}
 * - ${VAR_NAME:-default}  (with default value)
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface CredentialsConfig {
  /** Path to .env file (default: .env in cwd) */
  envFile?: string;
  /** Additional .env files to load (loaded in order, later files override) */
  envFiles?: string[];
  /** Whether to load from process.env (default: true) */
  useProcessEnv?: boolean;
  /** Base directory for resolving relative paths */
  baseDir?: string;
}

export interface LoadEnvResult {
  /** Whether any .env files were loaded */
  loaded: boolean;
  /** Paths of loaded .env files */
  files: string[];
  /** Number of variables loaded */
  count: number;
}

/**
 * Load environment variables from .env files
 */
export function loadEnv(options: CredentialsConfig = {}): LoadEnvResult {
  const baseDir = options.baseDir || process.cwd();
  const files: string[] = [];
  let totalCount = 0;

  // Determine which .env files to load
  const envFilePaths: string[] = [];

  if (options.envFiles) {
    envFilePaths.push(...options.envFiles.map((f) => resolve(baseDir, f)));
  } else if (options.envFile) {
    envFilePaths.push(resolve(baseDir, options.envFile));
  } else {
    // Default: look for .env, .env.local in order
    const defaultFiles = ['.env', '.env.local'];
    for (const file of defaultFiles) {
      const path = resolve(baseDir, file);
      if (existsSync(path)) {
        envFilePaths.push(path);
      }
    }
  }

  // Load each file (later files override earlier ones)
  for (const envPath of envFilePaths) {
    if (existsSync(envPath)) {
      const result = dotenvConfig({ path: envPath, override: true });
      if (!result.error && result.parsed) {
        files.push(envPath);
        totalCount += Object.keys(result.parsed).length;
      }
    }
  }

  return {
    loaded: files.length > 0,
    files,
    count: totalCount,
  };
}

/**
 * Resolve environment variable references in a string
 *
 * Supports:
 * - $VAR_NAME
 * - ${VAR_NAME}
 * - ${VAR_NAME:-default}
 */
export function resolveEnvString(value: string): string {
  // Pattern for ${VAR:-default} or ${VAR}
  const bracketPattern = /\$\{([^}:]+)(?::-([^}]*))?\}/g;
  // Pattern for $VAR (word characters only, not followed by {)
  const simplePattern = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

  let result = value;

  // First resolve ${VAR} and ${VAR:-default} patterns
  result = result.replace(bracketPattern, (_match, varName, defaultValue) => {
    const envValue = process.env[varName];
    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    // Return empty string if no value and no default
    return '';
  });

  // Then resolve $VAR patterns (only if not already resolved)
  result = result.replace(simplePattern, (_match, varName) => {
    const envValue = process.env[varName];
    return envValue !== undefined ? envValue : '';
  });

  return result;
}

/**
 * Check if a string contains env var references
 */
export function hasEnvReference(value: string): boolean {
  return /\$\{?[A-Za-z_][A-Za-z0-9_]*/.test(value);
}

/**
 * Recursively resolve all env var references in an object
 */
export function resolveCredentials<T>(config: T): T {
  if (config === null || config === undefined) {
    return config;
  }

  if (typeof config === 'string') {
    return resolveEnvString(config) as T;
  }

  if (Array.isArray(config)) {
    return config.map((item) => resolveCredentials(item)) as T;
  }

  if (typeof config === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      result[key] = resolveCredentials(value);
    }
    return result as T;
  }

  return config;
}

/**
 * Auth configuration types that can be resolved from env vars
 */
export interface AuthCredentials {
  [sourceName: string]: SourceCredentials;
}

export interface SourceCredentials {
  type: 'bearer' | 'oauth2' | 'api_key' | 'basic';
  /** Bearer token (for type: bearer) */
  token?: string;
  /** Access token (for type: oauth2) */
  accessToken?: string;
  /** Refresh token (for type: oauth2) */
  refreshToken?: string;
  /** Token endpoint URL (for type: oauth2) */
  tokenEndpoint?: string;
  /** OAuth2 client ID */
  clientId?: string;
  /** OAuth2 client secret */
  clientSecret?: string;
  /** API key value (for type: api_key) */
  apiKey?: string;
  /** API key header name (default: X-API-Key) */
  headerName?: string;
  /** Username (for type: basic) */
  username?: string;
  /** Password (for type: basic) */
  password?: string;
}

/**
 * Load and resolve credentials from a JSON file with env var interpolation
 */
export function loadCredentials(
  config: Record<string, unknown>,
  options: CredentialsConfig = {}
): AuthCredentials {
  // Load .env files first
  loadEnv(options);

  // Resolve env var references in the config
  return resolveCredentials(config) as AuthCredentials;
}

/**
 * Build credentials directly from environment variables using a naming convention
 *
 * Convention: REQON_{SOURCE}_{FIELD}
 * Example: REQON_GITHUB_TOKEN, REQON_XERO_CLIENT_ID
 */
export function credentialsFromEnv(sourceNames: string[]): AuthCredentials {
  const credentials: AuthCredentials = {};

  for (const sourceName of sourceNames) {
    const prefix = `REQON_${sourceName.toUpperCase()}_`;
    const sourceCredentials: Partial<SourceCredentials> = {};

    // Map env var suffixes to credential fields
    const fieldMappings: Record<string, keyof SourceCredentials> = {
      TYPE: 'type',
      TOKEN: 'token',
      ACCESS_TOKEN: 'accessToken',
      REFRESH_TOKEN: 'refreshToken',
      TOKEN_ENDPOINT: 'tokenEndpoint',
      CLIENT_ID: 'clientId',
      CLIENT_SECRET: 'clientSecret',
      API_KEY: 'apiKey',
      HEADER_NAME: 'headerName',
      USERNAME: 'username',
      PASSWORD: 'password',
    };

    for (const [suffix, field] of Object.entries(fieldMappings)) {
      const envVar = `${prefix}${suffix}`;
      const value = process.env[envVar];
      if (value !== undefined) {
        (sourceCredentials as Record<string, string>)[field] = value;
      }
    }

    // Only add if we found at least a type or token
    if (sourceCredentials.type || sourceCredentials.token || sourceCredentials.accessToken) {
      // Default to bearer if we have a token but no type
      if (!sourceCredentials.type && sourceCredentials.token) {
        sourceCredentials.type = 'bearer';
      }
      credentials[sourceName] = sourceCredentials as SourceCredentials;
    }
  }

  return credentials;
}
