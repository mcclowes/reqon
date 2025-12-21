import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveEnvString,
  hasEnvReference,
  resolveCredentials,
  credentialsFromEnv,
} from './credentials.js';

describe('resolveEnvString', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should resolve $VAR_NAME pattern', () => {
    process.env.MY_TOKEN = 'secret123';
    expect(resolveEnvString('Bearer $MY_TOKEN')).toBe('Bearer secret123');
  });

  it('should resolve ${VAR_NAME} pattern', () => {
    process.env.API_KEY = 'key456';
    expect(resolveEnvString('${API_KEY}')).toBe('key456');
  });

  it('should resolve ${VAR_NAME:-default} pattern with value present', () => {
    process.env.DB_HOST = 'production.db';
    expect(resolveEnvString('${DB_HOST:-localhost}')).toBe('production.db');
  });

  it('should use default when env var is missing', () => {
    delete process.env.MISSING_VAR;
    expect(resolveEnvString('${MISSING_VAR:-fallback}')).toBe('fallback');
  });

  it('should return empty string for missing var without default', () => {
    delete process.env.MISSING_VAR;
    expect(resolveEnvString('prefix-${MISSING_VAR}-suffix')).toBe('prefix--suffix');
  });

  it('should resolve multiple variables in one string', () => {
    process.env.HOST = 'api.example.com';
    process.env.PORT = '8080';
    expect(resolveEnvString('https://${HOST}:${PORT}/path')).toBe(
      'https://api.example.com:8080/path'
    );
  });

  it('should handle mixed patterns', () => {
    process.env.USER = 'admin';
    process.env.PASS = 'secret';
    expect(resolveEnvString('$USER:${PASS}')).toBe('admin:secret');
  });

  it('should not modify strings without env references', () => {
    expect(resolveEnvString('plain text')).toBe('plain text');
  });

  it('should handle empty default value', () => {
    delete process.env.EMPTY_DEFAULT;
    expect(resolveEnvString('${EMPTY_DEFAULT:-}')).toBe('');
  });
});

describe('hasEnvReference', () => {
  it('should detect $VAR pattern', () => {
    expect(hasEnvReference('token: $API_KEY')).toBe(true);
  });

  it('should detect ${VAR} pattern', () => {
    expect(hasEnvReference('${SECRET}')).toBe(true);
  });

  it('should detect ${VAR:-default} pattern', () => {
    expect(hasEnvReference('${VAR:-default}')).toBe(true);
  });

  it('should return false for plain strings', () => {
    expect(hasEnvReference('no variables here')).toBe(false);
  });

  it('should return false for partial patterns', () => {
    expect(hasEnvReference('$ not a var')).toBe(false);
  });
});

describe('resolveCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should resolve env vars in nested objects', () => {
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    process.env.XERO_CLIENT_ID = 'client123';
    process.env.XERO_CLIENT_SECRET = 'secret456';

    const config = {
      GitHub: {
        type: 'bearer',
        token: '$GITHUB_TOKEN',
      },
      Xero: {
        type: 'oauth2',
        clientId: '${XERO_CLIENT_ID}',
        clientSecret: '${XERO_CLIENT_SECRET}',
        tokenEndpoint: 'https://identity.xero.com/connect/token',
      },
    };

    const resolved = resolveCredentials(config);

    expect(resolved).toEqual({
      GitHub: {
        type: 'bearer',
        token: 'ghp_xxx',
      },
      Xero: {
        type: 'oauth2',
        clientId: 'client123',
        clientSecret: 'secret456',
        tokenEndpoint: 'https://identity.xero.com/connect/token',
      },
    });
  });

  it('should resolve env vars in arrays', () => {
    process.env.ITEM1 = 'first';
    process.env.ITEM2 = 'second';

    const config = ['$ITEM1', '${ITEM2}', 'static'];
    const resolved = resolveCredentials(config);

    expect(resolved).toEqual(['first', 'second', 'static']);
  });

  it('should handle null and undefined', () => {
    expect(resolveCredentials(null)).toBe(null);
    expect(resolveCredentials(undefined)).toBe(undefined);
  });

  it('should preserve non-string values', () => {
    const config = {
      timeout: 5000,
      enabled: true,
      items: [1, 2, 3],
    };

    expect(resolveCredentials(config)).toEqual(config);
  });
});

describe('credentialsFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should build credentials from REQON_* env vars', () => {
    process.env.REQON_GITHUB_TOKEN = 'ghp_xxx';
    process.env.REQON_GITHUB_TYPE = 'bearer';

    const creds = credentialsFromEnv(['GitHub']);

    expect(creds).toEqual({
      GitHub: {
        type: 'bearer',
        token: 'ghp_xxx',
      },
    });
  });

  it('should default to bearer when token is present without type', () => {
    process.env.REQON_STRIPE_TOKEN = 'sk_live_xxx';

    const creds = credentialsFromEnv(['Stripe']);

    expect(creds).toEqual({
      Stripe: {
        type: 'bearer',
        token: 'sk_live_xxx',
      },
    });
  });

  it('should handle oauth2 credentials', () => {
    process.env.REQON_XERO_TYPE = 'oauth2';
    process.env.REQON_XERO_ACCESS_TOKEN = 'access123';
    process.env.REQON_XERO_REFRESH_TOKEN = 'refresh456';
    process.env.REQON_XERO_CLIENT_ID = 'client789';
    process.env.REQON_XERO_TOKEN_ENDPOINT = 'https://identity.xero.com/connect/token';

    const creds = credentialsFromEnv(['Xero']);

    expect(creds).toEqual({
      Xero: {
        type: 'oauth2',
        accessToken: 'access123',
        refreshToken: 'refresh456',
        clientId: 'client789',
        tokenEndpoint: 'https://identity.xero.com/connect/token',
      },
    });
  });

  it('should handle api_key credentials', () => {
    process.env.REQON_SENDGRID_TYPE = 'api_key';
    process.env.REQON_SENDGRID_API_KEY = 'SG.xxx';
    process.env.REQON_SENDGRID_HEADER_NAME = 'Authorization';

    const creds = credentialsFromEnv(['SendGrid']);

    expect(creds).toEqual({
      SendGrid: {
        type: 'api_key',
        apiKey: 'SG.xxx',
        headerName: 'Authorization',
      },
    });
  });

  it('should skip sources with no credentials', () => {
    const creds = credentialsFromEnv(['Unknown', 'Missing']);

    expect(creds).toEqual({});
  });

  it('should handle multiple sources', () => {
    process.env.REQON_GITHUB_TOKEN = 'ghp_xxx';
    process.env.REQON_STRIPE_TOKEN = 'sk_xxx';

    const creds = credentialsFromEnv(['GitHub', 'Stripe', 'NoCredentials']);

    expect(creds).toEqual({
      GitHub: {
        type: 'bearer',
        token: 'ghp_xxx',
      },
      Stripe: {
        type: 'bearer',
        token: 'sk_xxx',
      },
    });
  });

  it('should be case-insensitive for source names', () => {
    process.env.REQON_MYAPI_TOKEN = 'token123';

    // Uppercase source name
    const creds = credentialsFromEnv(['MyApi']);

    expect(creds).toEqual({
      MyApi: {
        type: 'bearer',
        token: 'token123',
      },
    });
  });
});
