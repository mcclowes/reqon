/**
 * SQLite-backed execution log — durable, transactional state for single-process
 * self-hosting (the "SQLite-of-durable-execution" lane).
 *
 * The `better-sqlite3` driver is an *optional* peer dependency: only installed
 * by users who opt into the SQLite backend. It is imported lazily so the core
 * package carries no native dependency, and a missing driver yields a clear,
 * actionable error rather than an opaque module-resolution failure.
 *
 * Durability: WAL mode + `synchronous = NORMAL` gives fsync-backed commits that
 * survive a process crash, and `seq` is assigned atomically inside the INSERT
 * (guarded by a `(execution_id, seq)` primary key) so concurrent appenders
 * cannot collide on a sequence number.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ExecutionEvent, StoredEvent } from './events.js';
import type { CheckpointRecord, ExecutionLogStore } from './store.js';
import { reduceCheckpoints } from './store.js';

/** The slice of the better-sqlite3 API this adapter uses. */
interface SqliteStatement {
  run(params: Record<string, unknown>): unknown;
  get(params: Record<string, unknown>): unknown;
  all(params: Record<string, unknown>): unknown[];
}
interface SqliteDatabase {
  pragma(source: string): unknown;
  exec(source: string): unknown;
  prepare(source: string): SqliteStatement;
}
type SqliteConstructor = new (path: string) => SqliteDatabase;

export class SqliteExecutionLog implements ExecutionLogStore {
  private db?: SqliteDatabase;
  private insertStmt?: SqliteStatement;
  private readStmt?: SqliteStatement;
  private checkpointStmt?: SqliteStatement;
  private pauseStmt?: SqliteStatement;

  constructor(private path = '.reqon-data/execution-log.sqlite') {}

  private async ensureDb(): Promise<SqliteDatabase> {
    if (this.db) return this.db;

    if (this.path !== ':memory:') {
      await mkdir(dirname(this.path), { recursive: true });
    }

    let Database: SqliteConstructor;
    try {
      // Non-literal specifier: keeps the driver an optional dependency with no
      // compile-time type coupling (no @types/better-sqlite3 required).
      const specifier = 'better-sqlite3';
      const mod = (await import(specifier)) as { default: SqliteConstructor };
      Database = mod.default;
    } catch {
      throw new Error(
        "SqliteExecutionLog requires the optional peer dependency 'better-sqlite3'. " +
          'Install it with: npm install better-sqlite3'
      );
    }

    const db = new Database(this.path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(
      `CREATE TABLE IF NOT EXISTS events (
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        at TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (execution_id, seq)
      )`
    );

    // seq is computed inside the INSERT so it is assigned atomically, and
    // RETURNING hands it back without a second round-trip.
    this.insertStmt = db.prepare(
      `INSERT INTO events (execution_id, seq, at, data)
       VALUES (
         @id,
         (SELECT COALESCE(MAX(seq) + 1, 0) FROM events WHERE execution_id = @id),
         @at,
         @data
       )
       RETURNING seq`
    );
    this.readStmt = db.prepare(
      `SELECT seq, at, data FROM events WHERE execution_id = @id ORDER BY seq ASC`
    );
    this.checkpointStmt = db.prepare(
      `SELECT execution_id, seq, at, data FROM events
       WHERE json_extract(data, '$.type') = 'checkpoint.advanced'`
    );
    this.pauseStmt = db.prepare(
      `SELECT execution_id, seq, at, data FROM events
       WHERE json_extract(data, '$.type') IN ('pause.created', 'pause.resumed')`
    );

    this.db = db;
    return db;
  }

  async append(event: ExecutionEvent): Promise<StoredEvent> {
    await this.ensureDb();
    const at = new Date().toISOString();
    const { executionId } = event;
    const row = this.insertStmt!.get({
      id: executionId,
      at,
      data: JSON.stringify(event),
    }) as { seq: number };
    return { ...event, seq: row.seq, at } as StoredEvent;
  }

  async read(executionId: string): Promise<StoredEvent[]> {
    await this.ensureDb();
    const rows = this.readStmt!.all({ id: executionId }) as Array<{
      seq: number;
      at: string;
      data: string;
    }>;
    return rows.map((r) => ({ ...(JSON.parse(r.data) as ExecutionEvent), seq: r.seq, at: r.at }));
  }

  async listCheckpoints(mission?: string): Promise<CheckpointRecord[]> {
    await this.ensureDb();
    const rows = this.checkpointStmt!.all({}) as Array<{ seq: number; at: string; data: string }>;
    const events = rows.map(
      (r) => ({ ...(JSON.parse(r.data) as ExecutionEvent), seq: r.seq, at: r.at }) as StoredEvent
    );
    return reduceCheckpoints(events, mission);
  }

  async listPauses(): Promise<StoredEvent[]> {
    await this.ensureDb();
    const rows = this.pauseStmt!.all({}) as Array<{ seq: number; at: string; data: string }>;
    return rows.map(
      (r) => ({ ...(JSON.parse(r.data) as ExecutionEvent), seq: r.seq, at: r.at }) as StoredEvent
    );
  }
}
