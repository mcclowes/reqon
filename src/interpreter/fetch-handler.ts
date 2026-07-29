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
  log: (message: string, context?: Record<string, unknown>) => void;
  /** Optional event emitter for observability */
  emit?: <T>(type: EventType, payload: T) => void;
  /**
   * When set (durable mode), mutating requests carry a stable Idempotency-Key
   * derived from (executionId, stepId, request signature) so retries and
   * replays don't double-apply server-side where the API honours the header.
   */
  idempotency?: { executionId: string; stepId: string };
  /**
   * Resumable (backfill) pagination, wired in durable mode. `resume` seeds the
   * starting page/cursor from the folded log; `onPage` records each completed
   * page back to the log; `maxItemsPerRun` bounds memory per run (a backfill
   * that exceeds it stops cleanly and continues on the next resume).
   */
  pagination?: {
    resume?: { page: number; cursor?: string; done: boolean };
    onPage?: (progress: {
      page: number;
      cursor?: string;
      recordCount: number;
      done: boolean;
    }) => Promise<void>;
    maxItemsPerRun?: number;
  };
  /**
   * Default caps for non-backfill pagination (memory/runaway safety). A per-step
   * `paginate.maxPages` / `paginate.maxItems` overrides these; both fall back to
   * the module defaults. When a cap fires the result is flagged truncated.
   */
  maxPaginationPages?: number;
  maxPaginationItems?: number;
}

export interface FetchResult {
  data: unknown;
  checkpointKey?: string;
  /** Response status, so `match` arms can dispatch on an allowed status. */
  status?: number;
  /**
   * Set when pagination stopped early because a safety cap fired, so the fetched
   * data is a *partial* view of what the source holds. A sync checkpoint MUST
   * NOT advance past a truncated result: the un-fetched records predate the new
   * watermark and would never be requested again. See #246.
   */
  truncated?: TruncationInfo;
}

/** Why a paginated fetch stopped early, and how far it got. */
export interface TruncationInfo {
  reason: 'page-cap' | 'item-cap';
  pagesFetched: number;
  itemsFetched: number;
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

    const fetchStartTime = Date.now();

    if (this.deps.dryRun) {
      const mockData = this.generateDryRunMockData(resolved.sourceName, resolved.operationId);
      this.deps.log('(dry run - skipping actual request)');
      return { data: mockData, checkpointKey };
    }

    // Execute with or without pagination
    let data: unknown;
    let pagesFetched: number | undefined;
    let truncated: TruncationInfo | undefined;
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
        data = result.items;
        truncated = result.truncated;
        pagesFetched = result.pages;
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
            allow: step.allow,
          },
          step.retry
        );

        await this.validateOASResponse(resolved.sourceName, resolved.operationId, response.data);
        data = response.data;
        statusCode = response.status ?? 200;
      }

      const ms = Date.now() - fetchStartTime;

      // Emit fetch.complete event
      this.deps.emit?.('fetch.complete', {
        source: resolved.sourceName,
        method: resolved.method,
        path: resolved.path,
        statusCode,
        recordCount: this.countRecords(data) ?? 0,
        ms,
        pagesFetched,
      });
      this.deps.log(`Fetched ${resolved.method} ${resolved.path}`, {
        status: statusCode,
        ms,
        path: resolved.path,
      });

      // Truncation is a partial-data condition, not an error: surface it in
      // observability (not just the debug log) so a checkpoint that gets skipped
      // downstream is explained, and a run that returns fewer records than the
      // source holds is visible.
      if (truncated) {
        this.deps.emit?.('fetch.truncated', {
          source: resolved.sourceName,
          path: resolved.path,
          reason: truncated.reason,
          pagesFetched: truncated.pagesFetched,
          itemsFetched: truncated.itemsFetched,
        });
        this.deps.log(
          `Pagination truncated (${truncated.reason}) after ${truncated.pagesFetched} pages / ` +
            `${truncated.itemsFetched} items — result is partial; sync checkpoint will not advance.`,
          { path: resolved.path }
        );
      }
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

    return { data, checkpointKey, status: statusCode, truncated };
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('rate limit') ||
        message.includes('429') ||
        // Match http.ts, which retries every 5xx: reporting a retried 500/504 as
        // non-retryable would make the fetch.error event contradict what happened.
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')
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
  ): Promise<Date | undefined> {
    if (!this.deps.syncStore) return undefined;

    // Prefer the data's own clock; otherwise fall back to when the request was
    // issued (not now), so records written server-side during the fetch are
    // re-fetched next run rather than skipped on clock skew.
    let syncedAt = fallbackTime ?? new Date();

    // If updateFrom is specified, extract the timestamp from response. A
    // top-level array is walked for its newest timestamp — pages aren't
    // guaranteed newest-last, and silently falling back to wall-clock time
    // here would defeat the point of updateFrom.
    if (step.since?.updateFrom && data && typeof data === 'object') {
      const extracted = Array.isArray(data)
        ? maxTimestamp(data, step.since.updateFrom)
        : toTimestamp(extractNestedValue(data as Record<string, unknown>, step.since.updateFrom));
      if (extracted) {
        syncedAt = extracted;
      }
    }

    // A watermark never moves backwards. The sync stores enforce this too;
    // clamping here keeps the returned value and emitted events honest.
    const previous = await this.deps.syncStore.getLastSync(key);
    if (previous instanceof Date && previous > syncedAt) {
      syncedAt = previous;
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

    return syncedAt;
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
    const signature = `${executionId}\0${stepId}\0${method}\0${path}\0${JSON.stringify(body ?? null)}`;
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
  ): Promise<{ items: unknown[]; pages: number; truncated?: TruncationInfo }> {
    const allResults: unknown[] = [];
    const paginate = step.paginate!;
    const strategy = createPaginationStrategy(paginate);

    const ctx: PaginationContext = {
      page: 0,
      pageSize: paginate.pageSize,
    };

    // Resumable (backfill) pagination: seed the cursor/page from the last
    // persisted position so a restart continues from where it stopped.
    const backfill = this.deps.pagination;
    if (step.backfill && backfill?.resume) {
      if (backfill.resume.done) {
        this.deps.log('Backfill already complete; nothing to fetch.');
        return { items: [], pages: 0 };
      }
      ctx.page = backfill.resume.page;
      ctx.cursor = backfill.resume.cursor;
      this.deps.log(`Resuming backfill from page ${ctx.page + 1}`);
    }

    // A cap only means "clean stop-and-resume boundary" when progress is
    // actually being persisted (durable backfill). Otherwise the run has no
    // resume, so hitting a cap truncates the result and must be surfaced — never
    // silently treated as the end of the data (#246).
    const resumable = !!(step.backfill && backfill?.onPage);

    // Per-run caps. Precedence: explicit per-step option, then the runtime
    // default, then the module default. For a backfill the item cap also comes
    // from `maxItemsPerRun` (bounds memory per resumable run).
    const pageCap = paginate.maxPages ?? this.deps.maxPaginationPages ?? MAX_PAGINATION_PAGES;
    const itemCap =
      backfill?.maxItemsPerRun ??
      paginate.maxItems ??
      this.deps.maxPaginationItems ??
      MAX_PAGINATION_ITEMS;

    let hasMore = true;
    let stoppedByCap = false;
    let truncated: TruncationInfo | undefined;

    while (hasMore) {
      // Build query with pagination params
      const paginationQuery = strategy.buildQuery(ctx);
      const query: Record<string, string> = { ...sinceQuery, ...paginationQuery };
      const headers = Object.keys(sinceHeaders).length > 0 ? sinceHeaders : undefined;

      this.deps.log(`Fetching page ${ctx.page + 1}...`);

      const response = await client.request(
        { method, path: basePath, query, headers, allow: step.allow },
        step.retry
      );
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

      // Safety caps. Checked while there is still more data to fetch, so a
      // natural end that happens to land exactly on a cap is not misreported as
      // truncation. A resumable backfill records this as a stop-and-resume
      // boundary (done:false); a non-resumable run marks the result truncated.
      if (hasMore && allResults.length >= itemCap) {
        this.deps.log(`Pagination item limit (${itemCap}) reached`);
        hasMore = false;
        if (resumable) stoppedByCap = true;
        else
          truncated = {
            reason: 'item-cap',
            pagesFetched: ctx.page,
            itemsFetched: allResults.length,
          };
      } else if (hasMore && ctx.page >= pageCap) {
        this.deps.log(`Pagination page limit (${pageCap}) reached`);
        hasMore = false;
        if (resumable) stoppedByCap = true;
        else
          truncated = {
            reason: 'page-cap',
            pagesFetched: ctx.page,
            itemsFetched: allResults.length,
          };
      }

      // Record this page's position for a resumable backfill. `done` is the
      // natural end of pagination — never set when a cap stopped us early, so a
      // resume continues rather than treating the backfill as finished.
      if (step.backfill && backfill?.onPage) {
        await backfill.onPage({
          page: ctx.page,
          cursor: ctx.cursor,
          recordCount: pageResult.items.length,
          done: !hasMore && !stoppedByCap,
        });
      }

      // Emit heartbeat after each page
      this.deps.emit?.('fetch.heartbeat', {
        source: sourceName,
        path: basePath,
        pagesProcessed: ctx.page,
        itemsFetched: allResults.length,
        hasMore,
      });
    }

    this.deps.log(`Fetched ${allResults.length} total items`);
    return { items: allResults, pages: ctx.page, truncated };
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

/** Parse a value extracted from response data into a valid Date, or undefined. */
function toTimestamp(value: unknown): Date | undefined {
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

/** Newest `path` timestamp across an array response's items. */
function maxTimestamp(items: unknown[], path: string): Date | undefined {
  let max: Date | undefined;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const candidate = toTimestamp(extractNestedValue(item as Record<string, unknown>, path));
    if (candidate && (!max || candidate > max)) max = candidate;
  }
  return max;
}
