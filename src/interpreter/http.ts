import type { RetryConfig } from '../ast/nodes.js';

export interface HttpClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: AuthProvider;
}

export interface AuthProvider {
  getToken(): Promise<string>;
  refreshToken?(): Promise<string>;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  async request<T = unknown>(
    req: HttpRequest,
    retry?: RetryConfig
  ): Promise<HttpResponse<T>> {
    const url = this.buildUrl(req.path, req.query);
    const headers = await this.buildHeaders(req.headers);

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
    };

    const maxAttempts = retry?.maxAttempts ?? 3;
    const backoff = retry?.backoff ?? 'exponential';
    const initialDelay = retry?.initialDelay ?? 1000;
    const maxDelay = retry?.maxDelay ?? 30000;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          console.log(`Rate limited. Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }

        // Handle server errors with retry
        if (response.status >= 500 && attempt < maxAttempts) {
          const delay = this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          console.log(`Server error ${response.status}. Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }

        const data = await response.json() as T;
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          status: response.status,
          data,
          headers: responseHeaders,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxAttempts) {
          const delay = this.calculateDelay(attempt, backoff, initialDelay, maxDelay);
          console.log(`Request failed: ${lastError.message}. Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Request failed after all retries');
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${base}${cleanPath}`;

    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    return url;
  }

  private async buildHeaders(requestHeaders?: Record<string, string>): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.config.headers,
      ...requestHeaders,
    };

    if (this.config.auth) {
      const token = await this.config.auth.getToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private calculateDelay(
    attempt: number,
    backoff: 'exponential' | 'linear' | 'constant',
    initialDelay: number,
    maxDelay: number
  ): number {
    let delay: number;

    switch (backoff) {
      case 'exponential':
        delay = initialDelay * Math.pow(2, attempt - 1);
        break;
      case 'linear':
        delay = initialDelay * attempt;
        break;
      case 'constant':
      default:
        delay = initialDelay;
    }

    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    delay = Math.min(delay + jitter, maxDelay);

    return Math.round(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Simple token-based auth provider
export class BearerAuthProvider implements AuthProvider {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async getToken(): Promise<string> {
    return this.token;
  }
}

// OAuth2 auth provider (simplified)
export class OAuth2AuthProvider implements AuthProvider {
  private accessToken: string;
  private refreshTokenValue?: string;
  private tokenEndpoint?: string;
  private clientId?: string;
  private clientSecret?: string;

  constructor(config: {
    accessToken: string;
    refreshToken?: string;
    tokenEndpoint?: string;
    clientId?: string;
    clientSecret?: string;
  }) {
    this.accessToken = config.accessToken;
    this.refreshTokenValue = config.refreshToken;
    this.tokenEndpoint = config.tokenEndpoint;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async getToken(): Promise<string> {
    return this.accessToken;
  }

  async refreshToken(): Promise<string> {
    if (!this.refreshTokenValue || !this.tokenEndpoint) {
      throw new Error('Cannot refresh token: missing refresh token or endpoint');
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshTokenValue,
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
      }),
    });

    const data = await response.json() as { access_token: string; refresh_token?: string };
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshTokenValue = data.refresh_token;
    }

    return this.accessToken;
  }
}
