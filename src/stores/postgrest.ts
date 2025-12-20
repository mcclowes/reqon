import type { StoreAdapter, StoreFilter } from './types.js';

export interface PostgRESTOptions {
  /** Base URL for the PostgREST API (e.g., https://xxx.supabase.co/rest/v1) */
  url: string;
  /** API key for authentication */
  apiKey: string;
  /** Table name */
  table: string;
  /** Primary key column (default: 'id') */
  primaryKey?: string;
  /** Optional schema (for Supabase, typically 'public') */
  schema?: string;
}

/**
 * PostgREST-compatible store adapter.
 * Works with Supabase, standalone PostgREST, or any PostgREST-compatible API.
 *
 * @example
 * ```typescript
 * const store = new PostgRESTStore({
 *   url: 'https://xxx.supabase.co/rest/v1',
 *   apiKey: process.env.SUPABASE_ANON_KEY,
 *   table: 'users',
 * });
 * ```
 */
export class PostgRESTStore implements StoreAdapter {
  private baseUrl: string;
  private headers: Record<string, string>;
  private primaryKey: string;

  constructor(private options: PostgRESTOptions) {
    // Normalize URL (remove trailing slash)
    const url = options.url.replace(/\/$/, '');
    this.baseUrl = `${url}/${options.table}`;
    this.primaryKey = options.primaryKey ?? 'id';

    this.headers = {
      'Content-Type': 'application/json',
      'apikey': options.apiKey,
      'Authorization': `Bearer ${options.apiKey}`,
      'Prefer': 'return=representation',
    };

    if (options.schema) {
      this.headers['Accept-Profile'] = options.schema;
      this.headers['Content-Profile'] = options.schema;
    }
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const url = `${this.baseUrl}?${this.primaryKey}=eq.${encodeURIComponent(key)}&limit=1`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new PostgRESTError(`Failed to get record: ${response.statusText}`, response.status);
    }

    const data = await response.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    // Upsert using PostgREST's on_conflict resolution
    const record = { ...value, [this.primaryKey]: key };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to set record: ${error}`, response.status);
    }
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    const url = `${this.baseUrl}?${this.primaryKey}=eq.${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(value),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to update record: ${error}`, response.status);
    }
  }

  async delete(key: string): Promise<void> {
    const url = `${this.baseUrl}?${this.primaryKey}=eq.${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to delete record: ${error}`, response.status);
    }
  }

  async list(filter?: StoreFilter): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams();

    // Apply where clause
    if (filter?.where) {
      for (const [field, value] of Object.entries(filter.where)) {
        if (value === null) {
          params.append(field, 'is.null');
        } else if (typeof value === 'string') {
          params.append(field, `eq.${value}`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          params.append(field, `eq.${value}`);
        } else {
          // For complex values, try JSON
          params.append(field, `eq.${JSON.stringify(value)}`);
        }
      }
    }

    // Apply pagination
    if (filter?.limit) {
      params.append('limit', String(filter.limit));
    }
    if (filter?.offset) {
      params.append('offset', String(filter.offset));
    }

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}?${queryString}` : this.baseUrl;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to list records: ${error}`, response.status);
    }

    return response.json();
  }

  async clear(): Promise<void> {
    // Delete all records - PostgREST requires a filter, so we use a always-true condition
    // This deletes where primary key is not null (i.e., all records)
    const url = `${this.baseUrl}?${this.primaryKey}=not.is.null`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to clear records: ${error}`, response.status);
    }
  }

  /**
   * Bulk insert records (more efficient than individual sets)
   */
  async bulkInsert(records: Record<string, unknown>[]): Promise<void> {
    if (records.length === 0) return;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(records),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to bulk insert: ${error}`, response.status);
    }
  }

  /**
   * Count records matching a filter
   */
  async count(filter?: StoreFilter): Promise<number> {
    const params = new URLSearchParams();
    params.append('select', 'count');

    if (filter?.where) {
      for (const [field, value] of Object.entries(filter.where)) {
        if (value === null) {
          params.append(field, 'is.null');
        } else {
          params.append(field, `eq.${value}`);
        }
      }
    }

    const url = `${this.baseUrl}?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.headers,
        'Prefer': 'count=exact',
      },
    });

    if (!response.ok) {
      throw new PostgRESTError(`Failed to count records: ${response.statusText}`, response.status);
    }

    // Count is in the Content-Range header: "0-24/100"
    const range = response.headers.get('Content-Range');
    if (range) {
      const match = range.match(/\/(\d+|\*)/);
      if (match && match[1] !== '*') {
        return parseInt(match[1], 10);
      }
    }

    // Fallback: count the results
    const data = await response.json();
    return Array.isArray(data) ? data.length : 0;
  }

  private async parseError(response: Response): Promise<string> {
    try {
      const body = await response.json();
      return body.message || body.error || response.statusText;
    } catch {
      return response.statusText;
    }
  }
}

/**
 * Error class for PostgREST operations
 */
export class PostgRESTError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'PostgRESTError';
  }
}
