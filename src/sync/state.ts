/**
 * Sync State - Tracks last sync timestamps for incremental sync
 *
 * Enables "only fetch changed since last run" patterns:
 * - get "/invoices" { since: lastSync }
 * - fetch Xero.getInvoices { since: lastSync("invoices") }
 */

/**
 * Sync checkpoint - records when a sync completed
 */
export interface SyncCheckpoint {
  /** Unique key (e.g., "Xero:getInvoices" or "invoices") */
  key: string;
  /** Last successful sync timestamp */
  syncedAt: Date;
  /** Number of records fetched in last sync */
  recordCount?: number;
  /** Optional cursor for cursor-based pagination resume */
  cursor?: string;
  /** Mission that performed the sync */
  mission?: string;
  /** Execution ID that performed the sync */
  executionId?: string;
}

/**
 * Sync state for a mission/source
 */
export interface SyncState {
  /** Mission name */
  mission: string;
  /** Source name */
  source: string;
  /** Checkpoints by key */
  checkpoints: Map<string, SyncCheckpoint>;
  /** When this state was last updated */
  updatedAt: Date;
}

/**
 * Options for resolving a "since" value
 */
export interface SinceResolution {
  /** The resolved timestamp */
  timestamp: Date;
  /** Whether this is a fresh sync (no previous checkpoint) */
  isFreshSync: boolean;
  /** The checkpoint key used */
  key: string;
}

/**
 * Generate a checkpoint key for a fetch operation
 */
export function generateCheckpointKey(
  source: string,
  operationId?: string,
  endpoint?: string
): string {
  if (operationId) {
    return `${source}:${operationId}`;
  }
  if (endpoint) {
    // Normalize endpoint (remove query params, trailing slashes)
    const normalized = endpoint.split('?')[0].replace(/\/+$/, '');
    return `${source}:${normalized}`;
  }
  return source;
}

/**
 * Default "since" value for fresh syncs
 * Uses Unix epoch (1970-01-01) to fetch all historical data
 */
export const EPOCH = new Date(0);

/**
 * Common date formats for API "since" parameters
 */
export type SinceDateFormat = 'iso' | 'unix' | 'unix-ms' | 'date-only';

/**
 * Format a date for use in API requests
 */
export function formatSinceDate(date: Date, format: SinceDateFormat = 'iso'): string {
  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'unix':
      return Math.floor(date.getTime() / 1000).toString();
    case 'unix-ms':
      return date.getTime().toString();
    case 'date-only':
      return date.toISOString().split('T')[0];
    default:
      return date.toISOString();
  }
}

/**
 * Parse a date from various API response formats
 */
export function parseSinceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof value === 'number') {
    // Assume Unix timestamp in seconds if < year 3000 in seconds
    if (value < 32503680000) {
      return new Date(value * 1000);
    }
    // Otherwise assume milliseconds
    return new Date(value);
  }

  return null;
}
