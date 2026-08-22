import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { generateCheckpointKey, formatSinceDate, parseSinceDate, EPOCH } from './state.js';
import { FileSyncStore, MemorySyncStore } from './store.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';
import type { FetchStep, MissionDefinition } from '../ast/nodes.js';

const TEST_DIR = '.reqon-test-sync';

describe('Sync State Utilities', () => {
  describe('generateCheckpointKey', () => {
    it('generates key from source and operationId', () => {
      const key = generateCheckpointKey('Xero', 'getInvoices');
      expect(key).toBe('Xero:getInvoices');
    });

    it('generates key from source and endpoint', () => {
      const key = generateCheckpointKey('API', undefined, '/invoices');
      expect(key).toBe('API:/invoices');
    });

    it('normalizes endpoints (removes trailing slashes)', () => {
      const key = generateCheckpointKey('API', undefined, '/invoices/');
      expect(key).toBe('API:/invoices');
    });

    it('falls back to source only', () => {
      const key = generateCheckpointKey('API');
      expect(key).toBe('API');
    });
  });

  describe('formatSinceDate', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');

    it('formats as ISO string', () => {
      expect(formatSinceDate(date, 'iso')).toBe('2024-01-15T10:30:00.000Z');
    });

    it('formats as Unix timestamp (seconds)', () => {
      expect(formatSinceDate(date, 'unix')).toBe('1705314600');
    });

    it('formats as Unix timestamp (milliseconds)', () => {
      expect(formatSinceDate(date, 'unix-ms')).toBe('1705314600000');
    });

    it('formats as date only', () => {
      expect(formatSinceDate(date, 'date-only')).toBe('2024-01-15');
    });
  });

  describe('parseSinceDate', () => {
    it('parses ISO string', () => {
      const result = parseSinceDate('2024-01-15T10:30:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('parses Unix timestamp (seconds)', () => {
      const result = parseSinceDate(1705314600);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(1705314600000);
    });

    it('parses Unix timestamp (milliseconds)', () => {
      const result = parseSinceDate(1705314600000);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(1705314600000);
    });

    it('returns null for invalid input', () => {
      expect(parseSinceDate('not a date')).toBeNull();
      expect(parseSinceDate(null)).toBeNull();
      expect(parseSinceDate(undefined)).toBeNull();
    });

    it('passes through Date objects', () => {
      const date = new Date();
      expect(parseSinceDate(date)).toBe(date);
    });
  });
});

describe('MemorySyncStore', () => {
  let store: MemorySyncStore;

  beforeEach(() => {
    store = new MemorySyncStore();
  });

  it('returns EPOCH for unknown keys', async () => {
    const lastSync = await store.getLastSync('unknown');
    expect(lastSync.getTime()).toBe(EPOCH.getTime());
  });

  it('records and retrieves sync checkpoints', async () => {
    const syncedAt = new Date();
    await store.recordSync({
      key: 'Xero:getInvoices',
      syncedAt,
      recordCount: 100,
    });

    const lastSync = await store.getLastSync('Xero:getInvoices');
    expect(lastSync.getTime()).toBe(syncedAt.getTime());

    const checkpoint = await store.getCheckpoint('Xero:getInvoices');
    expect(checkpoint?.recordCount).toBe(100);
  });

  it('lists all checkpoints', async () => {
    await store.recordSync({ key: 'A', syncedAt: new Date() });
    await store.recordSync({ key: 'B', syncedAt: new Date() });

    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it('clears specific checkpoint', async () => {
    await store.recordSync({ key: 'A', syncedAt: new Date() });
    await store.recordSync({ key: 'B', syncedAt: new Date() });
    await store.clear('A');

    expect(await store.getCheckpoint('A')).toBeNull();
    expect(await store.getCheckpoint('B')).not.toBeNull();
  });

  it('clears all checkpoints', async () => {
    await store.recordSync({ key: 'A', syncedAt: new Date() });
    await store.recordSync({ key: 'B', syncedAt: new Date() });
    await store.clearAll();

    const all = await store.list();
    expect(all).toHaveLength(0);
  });
});

describe('FileSyncStore', () => {
  let store: FileSyncStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    store = new FileSyncStore('test-mission', TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('creates sync directory', async () => {
    // Trigger initialization by calling any async method
    await store.list();
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('persists checkpoints to disk', async () => {
    const syncedAt = new Date();
    await store.recordSync({
      key: 'test-key',
      syncedAt,
      recordCount: 50,
    });

    // Create new store instance
    const newStore = new FileSyncStore('test-mission', TEST_DIR);
    const checkpoint = await newStore.getCheckpoint('test-key');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.syncedAt.getTime()).toBe(syncedAt.getTime());
    expect(checkpoint?.recordCount).toBe(50);
  });
});

/**
 * A watermark is monotonic by definition: recording an older syncedAt must
 * never rewind it, or a `set`-mode store can overwrite newer local state with
 * an older version on the next incremental sync (#257). `clear` remains the
 * explicit way to reset a checkpoint.
 */
describe.each([
  ['MemorySyncStore', () => new MemorySyncStore()],
  ['FileSyncStore', () => new FileSyncStore('monotonic-mission', TEST_DIR)],
])('%s watermark monotonicity', (_name, makeStore) => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('ignores a checkpoint older than the existing watermark', async () => {
    const store = makeStore();
    await store.recordSync({ key: 'A', syncedAt: new Date('2026-02-01T00:00:00Z') });
    await store.recordSync({ key: 'A', syncedAt: new Date('2026-01-01T00:00:00Z'), cursor: 'c9' });

    expect((await store.getLastSync('A')).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    // The stale record is dropped whole, not merged field-by-field.
    expect((await store.getCheckpoint('A'))?.cursor).toBeUndefined();
  });

  it('advances the watermark for a newer checkpoint', async () => {
    const store = makeStore();
    await store.recordSync({ key: 'A', syncedAt: new Date('2026-01-01T00:00:00Z') });
    await store.recordSync({ key: 'A', syncedAt: new Date('2026-02-01T00:00:00Z') });

    expect((await store.getLastSync('A')).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('still resets via clear', async () => {
    const store = makeStore();
    await store.recordSync({ key: 'A', syncedAt: new Date('2026-02-01T00:00:00Z') });
    await store.clear('A');
    await store.recordSync({ key: 'A', syncedAt: new Date('2026-01-01T00:00:00Z') });

    expect((await store.getLastSync('A')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('Parser: since config', () => {
  function parse(source: string) {
    const lexer = new ReqonLexer(source);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens);
    return parser.parse();
  }

  it('parses since: lastSync', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        action Fetch {
          get "/items" {
            since: lastSync
          }
          store response -> items { key: .id }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const fetch = mission.actions[0].steps[0] as FetchStep;

    expect(fetch.since).toBeDefined();
    expect(fetch.since?.type).toBe('lastSync');
  });

  it('parses since: lastSync("custom-key")', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        action Fetch {
          get "/items" {
            since: lastSync("my-custom-key")
          }
          store response -> items { key: .id }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const fetch = mission.actions[0].steps[0] as FetchStep;

    expect(fetch.since?.type).toBe('lastSync');
    expect(fetch.since?.key).toBe('my-custom-key');
  });

  it('parses since: lastSync with options', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        action Fetch {
          get "/items" {
            since: lastSync {
              param: "modified_since",
              format: unix
            }
          }
          store response -> items { key: .id }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const fetch = mission.actions[0].steps[0] as FetchStep;

    expect(fetch.since?.type).toBe('lastSync');
    expect(fetch.since?.param).toBe('modified_since');
    expect(fetch.since?.format).toBe('unix');
  });

  it('parses since: lastSync with header option', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        action Fetch {
          get "/items" {
            since: lastSync {
              header: "If-Modified-Since"
            }
          }
          store response -> items { key: .id }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const fetch = mission.actions[0].steps[0] as FetchStep;

    expect(fetch.since?.type).toBe('lastSync');
    expect(fetch.since?.header).toBe('If-Modified-Since');
    expect(fetch.since?.param).toBeUndefined();
  });

  it('parses since: lastSync with header and format options', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        action Fetch {
          get "/items" {
            since: lastSync {
              header: "If-Modified-Since",
              format: iso
            }
          }
          store response -> items { key: .id }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const fetch = mission.actions[0].steps[0] as FetchStep;

    expect(fetch.since?.type).toBe('lastSync');
    expect(fetch.since?.header).toBe('If-Modified-Since');
    expect(fetch.since?.format).toBe('iso');
  });
});
