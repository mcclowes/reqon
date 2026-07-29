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
  /**
   * Per-request timeout in milliseconds (default: 30000). Every request is
   * aborted after this elapses so a hung connection can't stall a mission.
   */
  timeoutMs?: number;
  /**
   * Opt-in guard for {@link PostgRESTStore.clear}, which issues a full-table
   * DELETE. Defaults to false so a misconfigured store (e.g. a `sql` type
   * resolving here by mistake) can't wipe a table.
   */
  allowFullTableClear?: boolean;
}

/** PostgREST query parameters that are operators/modifiers, not columns. */
const RESERVED_QUERY_KEYS = new Set([
  'or',
  'and',
  'not',
  'select',
  'order',
  'limit',
  'offset',
  'on_conflict',
  'columns',
]);

/** A bare, safe column identifier: no operators, separators, or grouping. */
const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  private timeoutMs: number;

  constructor(private options: PostgRESTOptions) {
    // Normalize URL (remove trailing slash)
    const url = options.url.replace(/\/$/, '');
    this.baseUrl = `${url}/${options.table}`;
    this.primaryKey = options.primaryKey ?? 'id';
    this.timeoutMs = options.timeoutMs ?? 30000;

    this.headers = {
      'Content-Type': 'application/json',
      apikey: options.apiKey,
      Authorization: `Bearer ${options.apiKey}`,
      Prefer: 'return=representation',
    };

    if (options.schema) {
      this.headers['Accept-Profile'] = options.schema;
      this.headers['Content-Profile'] = options.schema;
    }
  }

  /** fetch wrapper that aborts the request once {@link timeoutMs} elapses. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new PostgRESTError(`Request timed out after ${this.timeoutMs}ms`, 0);
      }
      throw error;
    }
  }

  /**
   * Reject a where-clause field unless it is a plain column identifier. This
   * stops a key such as `or` or `id,or=(...)` from being concatenated into the
   * query string and reinterpreted as a PostgREST operator.
   */
  private validateField(field: string): void {
    if (!SAFE_FIELD.test(field) || RESERVED_QUERY_KEYS.has(field.toLowerCase())) {
      throw new PostgRESTError(`Unsafe filter field name: ${JSON.stringify(field)}`, 0);
    }
  }

  /**
   * Render a where-clause value as a PostgREST operand. Strings containing
   * reserved characters are wrapped in a quoted operand (with `"` and `\`
   * escaped) so they can't be parsed as list/group syntax.
   */
  private formatFilterValue(value: unknown): string {
    if (value === null) return 'is.null';
    if (typeof value === 'number' || typeof value === 'boolean') return `eq.${value}`;
    if (typeof value === 'string') {
      if (/[,.()"\\:]|\s/.test(value)) {
        return `eq."${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      }
      return `eq.${value}`;
    }
    // Complex values: JSON-encode, then quote as a string operand.
    const json = JSON.stringify(value);
    return `eq."${json.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  /** Append a validated, escaped where clause to the given params. */
  private applyWhere(params: URLSearchParams, where: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(where)) {
      this.validateField(field);
      params.append(field, this.formatFilterValue(value));
    }
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const url = `${this.baseUrl}?${this.primaryKey}=eq.${encodeURIComponent(key)}&limit=1`;

    const response = await this.request(url, {
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

    const response = await this.request(this.baseUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(`Failed to set record: ${error}`, response.status);
    }
  }

  /**
   * Insert-or-replace a batch in one round-trip. PostgREST accepts an array
   * body; `merge-duplicates` resolves conflicts on the primary key.
   *
   * Duplicate keys within the batch are collapsed first: a multi-row insert with
   * ON CONFLICT cannot affect the same row twice in one statement, so PostgREST
   * would reject the whole batch. Last write wins, shallow-merged, matching the
   * order the records arrived.
   */
  async bulkSet(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void> {
    await this.bulkWrite(records, false);
  }

  /** Bulk upsert - same wire shape as {@link bulkSet}; the primary key resolves conflicts. */
  async bulkUpsert(records: Array<{ key: string; value: Record<string, unknown> }>): Promise<void> {
    await this.bulkWrite(records, true);
  }

  private async bulkWrite(
    records: Array<{ key: string; value: Record<string, unknown> }>,
    merge: boolean
  ): Promise<void> {
    if (records.length === 0) return;

    // Collapse duplicate keys: Postgres rejects a statement that touches the
    // same conflict target twice. For a plain set the later value replaces the
    // earlier; for an upsert we shallow-merge, both in arrival order.
    const byKey = new Map<string, Record<string, unknown>>();
    for (const { key, value } of records) {
      // Keep the record's own primary-key field if it has one - stamping the
      // string key over a numeric id would change its type. Only fill it in
      // when absent.
      const stamped =
        this.primaryKey in value ? { ...value } : { ...value, [this.primaryKey]: key };
      const existing = byKey.get(key);
      byKey.set(key, existing && merge ? { ...existing, ...stamped } : stamped);
    }

    const response = await this.request(this.baseUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        // return=minimal: don't pull N rows back over the wire just to discard them.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([...byKey.values()]),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new PostgRESTError(
        `Failed to bulk write ${byKey.size} records: ${error}`,
        response.status
      );
    }
  }

  async update(key: string, value: Partial<Record<string, unknown>>): Promise<void> {
    const url = `${this.baseUrl}?${this.primaryKey}=eq.${encodeURIComponent(key)}`;

    const response = await this.request(url, {
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

    const response = await this.request(url, {
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
      this.applyWhere(params, filter.where);
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

    const response = await this.request(url, {
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
    if (!this.options.allowFullTableClear) {
      throw new PostgRESTError(
        'Refusing full-table delete: set allowFullTableClear to enable clear()',
        0
      );
    }

    // Delete all records - PostgREST requires a filter, so we use a always-true condition
    // This deletes where primary key is not null (i.e., all records)
    const url = `${this.baseUrl}?${this.primaryKey}=not.is.null`;

    const response = await this.request(url, {
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

    const response = await this.request(this.baseUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=merge-duplicates',
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
      this.applyWhere(params, filter.where);
    }

    const url = `${this.baseUrl}?${params.toString()}`;

    const response = await this.request(url, {
      method: 'GET',
      headers: {
        ...this.headers,
        Prefer: 'count=exact',
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
