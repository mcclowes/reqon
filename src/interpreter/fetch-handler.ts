import { createHash } from 'node:crypto';
import type { FetchStep } from '../ast/nodes.js';
import type { ExecutionContext } from './context.js';
import { evaluate, interpolatePath } from './evaluator.js';
import { HttpClient } from './http.js';
import {
  resolveOperation,
  getResponseSchema,
  validateResponse,
  generateMockData,
} from '../oas/index.js';
import type { OASSource } from '../oas/index.js';
import { generateCheckpointKey, formatSinceDate, type SyncStore } from '../sync/index.js';
import { extractNestedValue } from '../utils/path.js';
import type { EventType } from '../observability/index.js';
import { createPaginationStrategy, type PaginationContext } from './pagination.js';

/** Maximum pages to fetch to prevent infinite loops */
const MAX_PAGINATION_PAGES = 100;

/**
 * Maximum items to accumulate in memory across all pages. Results are buffered
 * in one array (no per-page streaming yet), so this caps memory regardless of
 * page size. Hitting it stops pagination with a warning.
 */
const MAX_PAGINATION_ITEMS = 100_000;

export interface FetchHandlerDeps {
  ctx: ExecutionContext;
  oasSources: Map<string, OASSource>;
  sourceConfigs: Map<string, { config: { validateResponses?: boolean } }>;
  syncStore?: SyncStore;
  missionName?: string;
  executionId?: string;
  dryRun?: boolean;
  log: (message: string) => void;
  /** Optional event emitter for observability */
  emit?: <T>(type: EventType, payload: T) => void;
  /**
   * When set (durable mode), mutating requests carry a stable Idempotency-Key
   * derived from (executionId, stepId, request signature) so retries and
   * replays don't double-apply server-side where the API honours the header.
   */
  idempotency?: { executionId: string; stepId: string };
}

export interface FetchResult {
  data: unknown;
  checkpointKey?: string;
}

/**
 * Handles HTTP fetch operations including pagination and incremental sync.
 * Extracted from MissionExecutor for better separation of concerns.
 */
export class FetchHandler {
  constructor(private deps: FetchHandlerDeps) {}

  /**
   * Execute a fetch step, handling OAS resolution, pagination, and sync checkpoints.
   */
  async execute(step: FetchStep): Promise<FetchResult> {
    const resolved = this.resolveFetchTarget(step);

    const client = this.deps.ctx.sources.get(resolved.sourceName);
    if (!client) {
      throw new Error(`Source not found: ${resolved.sourceName}`);
    }

    // Resolve "since" query parameter and/or header for incremental sync
    const {
      query: sinceQuery,
      headers: sinceHeaders,
      checkpointKey,
    } = await this.resolveSinceParams(
      step,
      resolved.sourceName,
      resolved.operationId,
      resolved.path
    );

    // Emit fetch.start event
    this.deps.emit?.('fetch.start', {
      source: resolved.sourceName,
      method: resolved.method,
      path: resolved.path,
      isOAS: !!resolved.operationId,
      operationId: resolved.operationId,
      hasPagination: !!step.paginate,
      hasSince: !!step.since,
    });

    const _fetchStartTime = Date.now(); // Reserved for fetch duration tracking

    if (this.deps.dryRun) {
      const mockData = this.generateDryRunMockData(resolved.sourceName, resolved.operationId);
      this.deps.log('(dry run - skipping actual request)');
      return { data: mockData, checkpointKey };
    }

    // Execute with or without pagination
    let data: unknown;
    let pagesFetched: number | undefined;
    let statusCode = 200;

    try {
      if (step.paginate) {
        const result = await this.executePaginated(
          step,
          client,
          resolved.path,
          resolved.method,
          resolved.sourceName,
          resolved.operationId,
          sinceQuery,
          sinceHeaders
        );
        data = result;
        pagesFetched = Array.isArray(result) ? undefined : 1; // Will be set by executePaginated
      } else {
        const body = step.body ? evaluate(step.body, this.deps.ctx) : undefined;
        const response = await client.request(
          {
            method: resolved.method,
            path: resolved.path,
            query: Object.keys(sinceQuery).length > 0 ? sinceQuery : undefined,
            headers: Object.keys(sinceHeaders).length > 0 ? sinceHeaders : undefined,
            body,
            idempotencyKey: this.idempotencyKeyFor(resolved.method, resolved.path, body),
          },
          step.retry
        );

        await this.validateOASResponse(resolved.sourceName, resolved.operationId, response.data);
        data = response.data;
        statusCode = response.status ?? 200;
      }

      // Emit fetch.complete event
      this.deps.emit?.('fetch.complete', {
        source: resolved.sourceName,
        method: resolved.method,
        path: resolved.path,
        statusCode,
        recordCount: this.countRecords(data) ?? 0,
        pagesFetched,
      });
    } catch (error) {
      // Emit fetch.error event
      this.deps.emit?.('fetch.error', {
        source: resolved.sourceName,
        path: resolved.path,
        error: (error as Error).message,
        retryable: this.isRetryableError(error),
      });
      throw error;
    }

    return { data, checkpointKey };
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('503') ||
        message.includes('502')
      );
    }
    return false;
  }

  /**
   * Record a sync checkpoint after successful fetch.
   */
  async recordCheckpoint(
    key: string,
    step: FetchStep,
    data: unknown,
    fallbackTime?: Date
  ): Promise<void> {
    if (!this.deps.syncStore) return;

    // Prefer the data's own clock; otherwise fall back to when the request was
    // issued (not now), so records written server-side during the fetch are
    // re-fetched next run rather than skipped on clock skew.
    let syncedAt = fallbackTime ?? new Date();

    // If updateFrom is specified, extract the timestamp from response
    if (step.since?.updateFrom && data && typeof data === 'object') {
      const extracted = extractNestedValue(data as Record<string, unknown>, step.since.updateFrom);
      if (extracted instanceof Date) {
        syncedAt = extracted;
      } else if (typeof extracted === 'string' || typeof extracted === 'number') {
        const parsed = new Date(extracted);
        if (!isNaN(parsed.getTime())) {
          syncedAt = parsed;
        }
      }
    }

    // Count records if response is an array
    const recordCount = this.countRecords(data);

    await this.deps.syncStore.recordSync({
      key,
      syncedAt,
      recordCount,
      mission: this.deps.missionName,
      executionId: this.deps.executionId,
    });

    this.deps.log(`Recorded sync checkpoint: ${key} at ${syncedAt.toISOString()}`);

    // Emit sync.checkpoint event
    this.deps.emit?.('sync.checkpoint', {
      checkpointKey: key,
      lastSyncTime: syncedAt.toISOString(),
      recordsFetched: recordCount ?? 0,
      isIncremental: true,
    });
  }

  private resolveFetchTarget(step: FetchStep): {
    sourceName: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    operationId?: string;
  } {
    if (step.operationRef) {
      // OAS-style: resolve from operationId
      const sourceName = step.operationRef.source;
      const operationId = step.operationRef.operationId;

      const oasSource = this.deps.oasSources.get(sourceName);
      if (!oasSource) {
        throw new Error(
          `Source '${sourceName}' does not have an OAS spec. Use 'source ${sourceName} from "spec.yaml"'`
        );
      }

      const operation = resolveOperation(oasSource, operationId);
      const path = interpolatePath(operation.path, this.deps.ctx);

      this.deps.log(`Fetching: ${sourceName}.${operationId} -> ${operation.method} ${path}`);

      return { sourceName, method: operation.method, path, operationId };
    }

    // Traditional: explicit method + path
    let sourceName = step.source;
    if (!sourceName) {
      // Use the first available source as default
      const firstSource = this.deps.ctx.sources.keys().next();
      if (firstSource.done) {
        throw new Error(
          'No sources defined. Add a source to your mission before making fetch requests.'
        );
      }
      sourceName = firstSource.value;
    }
    const method = step.method!;
    let path: string;

    if (step.path!.type === 'Literal' && step.path!.dataType === 'string') {
      path = interpolatePath(step.path!.value as string, this.deps.ctx);
    } else {
      path = String(evaluate(step.path!, this.deps.ctx));
    }

    this.deps.log(`Fetching: ${method} ${path}`);

    return { sourceName, method, path };
  }

  private async resolveSinceParams(
    step: FetchStep,
    sourceName: string,
    operationId: string | undefined,
    path: string
  ): Promise<{
    query: Record<string, string>;
    headers: Record<string, string>;
    checkpointKey?: string;
  }> {
    const query: Record<string, string> = {};
    const headers: Record<string, string> = {};

    if (!step.since || !this.deps.syncStore) {
      return { query, headers };
    }

    const checkpointKey = step.since.key ?? generateCheckpointKey(sourceName, operationId, path);

    if (step.since.type === 'lastSync') {
      const lastSync = await this.deps.syncStore.getLastSync(checkpointKey);
      const format = step.since.format ?? 'iso';
      const formattedDate = formatSinceDate(lastSync, format);

      if (step.since.header) {
        // Send as header (e.g., If-Modified-Since)
        headers[step.since.header] = formattedDate;
        this.deps.log(
          `Incremental sync: header ${step.since.header}=${formattedDate} (key: ${checkpointKey})`
        );
      } else {
        // Send as query parameter (default behavior)
        const paramName = step.since.param ?? 'since';
        query[paramName] = formattedDate;
        this.deps.log(`Incremental sync: ${paramName}=${formattedDate} (key: ${checkpointKey})`);
      }
    } else if (step.since.type === 'expression' && step.since.expression) {
      const value = evaluate(step.since.expression, this.deps.ctx);
      if (step.since.header) {
        headers[step.since.header] = String(value);
      } else {
        const paramName = step.since.param ?? 'since';
        query[paramName] = String(value);
      }
    }

    return { query, headers, checkpointKey };
  }

  /**
   * Idempotency-Key header for a mutating request, when durable mode is on.
   *
   * GET is safe and gets no key. The key is a hash of
   * (executionId, stepId, method, path, body) so it is stable across retries
   * and replays of the same request, yet distinct per loop iteration (different
   * path/body) — letting a cooperating API dedupe re-issued effects.
   */
  private idempotencyKeyFor(method: string, path: string, body: unknown): string | undefined {
    if (!this.deps.idempotency || method === 'GET') return undefined;
    const { executionId, stepId } = this.deps.idempotency;
    const signature = `${executionId} ${stepId} ${method} ${path} ${JSON.stringify(body ?? null)}`;
    return createHash('sha256').update(signature).digest('hex').slice(0, 32);
  }

  private async executePaginated(
    step: FetchStep,
    client: HttpClient,
    basePath: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    sourceName: string,
    operationId?: string,
    sinceQuery: Record<string, string> = {},
    sinceHeaders: Record<string, string> = {}
  ): Promise<unknown[]> {
    const allResults: unknown[] = [];
    const paginate = step.paginate!;
    const strategy = createPaginationStrategy(paginate);

    const ctx: PaginationContext = {
      page: 0,
      pageSize: paginate.pageSize,
    };

    let hasMore = true;

    while (hasMore) {
      // Build query with pagination params
      const paginationQuery = strategy.buildQuery(ctx);
      const query: Record<string, string> = { ...sinceQuery, ...paginationQuery };
      const headers = Object.keys(sinceHeaders).length > 0 ? sinceHeaders : undefined;

      this.deps.log(`Fetching page ${ctx.page + 1}...`);

      const response = await client.request({ method, path: basePath, query, headers }, step.retry);
      await this.validateOASResponse(sourceName, operationId, response.data);

      // Temporarily set response for until condition evaluation
      this.deps.ctx.response = response.data;

      // Extract and append the current page BEFORE deciding whether to stop, so
      // the page that satisfies `until` is not silently dropped.
      const pageResult = strategy.extractResults(response.data, ctx);
      allResults.push(...pageResult.items);
      hasMore = pageResult.hasMore;

      // Advance the cursor. If the API echoes the cursor we just used, stop
      // instead of looping to the page cap and duplicating items each round.
      if (pageResult.nextCursor !== undefined) {
        if (pageResult.nextCursor === ctx.cursor) {
          this.deps.log(
            `Pagination cursor did not advance ('${pageResult.nextCursor}'); stopping.`
          );
          hasMore = false;
        } else {
          ctx.cursor = pageResult.nextCursor;
        }
      }

      ctx.page++;

      // `until` is checked after the current page has been appended.
      if (hasMore && step.until && evaluate(step.until, this.deps.ctx)) {
        hasMore = false;
      }

      // Memory safety: cap total accumulated items, not just page count.
      if (allResults.length >= MAX_PAGINATION_ITEMS) {
        this.deps.log(`Warning: pagination item limit (${MAX_PAGINATION_ITEMS}) reached`);
        hasMore = false;
      }

      // Emit heartbeat after each page
      this.deps.emit?.('fetch.heartbeat', {
        source: sourceName,
        path: basePath,
        pagesProcessed: ctx.page,
        itemsFetched: allResults.length,
        hasMore,
      });

      // Safety limit
      if (ctx.page >= MAX_PAGINATION_PAGES) {
        this.deps.log(`Warning: pagination limit (${MAX_PAGINATION_PAGES}) reached`);
        hasMore = false;
      }
    }

    this.deps.log(`Fetched ${allResults.length} total items`);
    return allResults;
  }

  private countRecords(data: unknown): number | undefined {
    if (Array.isArray(data)) {
      return data.length;
    }

    if (data && typeof data === 'object') {
      for (const val of Object.values(data)) {
        if (Array.isArray(val)) {
          return val.length;
        }
      }
    }

    return undefined;
  }

  private async validateOASResponse(
    sourceName: string,
    operationId: string | undefined,
    data: unknown
  ): Promise<void> {
    if (!operationId) return;

    const sourceConfig = this.deps.sourceConfigs.get(sourceName);
    if (!sourceConfig?.config.validateResponses) return;

    const oasSource = this.deps.oasSources.get(sourceName);
    if (!oasSource) return;

    const schema = getResponseSchema(oasSource, operationId);
    if (!schema) {
      this.deps.log(`No response schema found for ${operationId}`);
      return;
    }

    const result = validateResponse(data, schema);
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
      this.deps.log(`Response validation warnings for ${operationId}:\n${errorMessages}`);
    }
  }

  /**
   * Generate mock data for dry run mode.
   * Uses OAS response schema if available, otherwise returns a simple placeholder.
   */
  private generateDryRunMockData(sourceName: string, operationId?: string): unknown {
    // Try to get schema from OAS source
    if (operationId) {
      const oasSource = this.deps.oasSources.get(sourceName);
      if (oasSource) {
        const schema = getResponseSchema(oasSource, operationId);
        if (schema) {
          this.deps.log(`Generating mock data from OAS schema for ${operationId}`);
          return generateMockData(schema);
        }
      }
    }

    // Fallback to simple placeholder
    return { _dryRun: true, _message: 'No OAS schema available for mock generation' };
  }
}
