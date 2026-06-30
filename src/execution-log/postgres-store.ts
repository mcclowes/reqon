/**
 * Postgres-backed execution log — a transactional, multi-node durable backend.
 *
 * Like the SQLite backend, `pg` is an *optional* peer dependency imported lazily
 * via a non-literal specifier, so the core package carries no database driver
 * and a missing one yields a clear, actionable error.
 *
 * Multi-writer safety: `seq` is assigned inside the INSERT under a
 * `(execution_id, seq)` primary key. If two appenders race and compute the same
 * next seq, one wins and the other gets a unique-violation (SQLSTATE 23505) and
 * retries against the now-higher max — so concurrent appenders always land on
 * distinct, contiguous sequence numbers.
 */
import type { ExecutionEvent, StoredEvent } from './events.js';
import type { CheckpointRecord, ExecutionLogStore } from './store.js';
import { reduceCheckpoints } from './store.js';

/** The slice of the `pg` API this adapter uses. */
interface PgQueryResult<R> {
  rows: R[];
}
interface PgPool {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
}
type PgPoolCtor = new (config: { connectionString: string }) => PgPool;

const UNIQUE_VIOLATION = '23505';
const MAX_APPEND_ATTEMPTS = 8;

export interface PostgresExecutionLogOptions {
  /** Table to store events in. Default `reqon_execution_events`. */
  table?: string;
}

export class PostgresExecutionLog implements ExecutionLogStore {
  private pool?: PgPool;
  private ready?: Promise<PgPool>;
  private readonly table: string;

  constructor(
    private connectionString: string,
    options: PostgresExecutionLogOptions = {}
  ) {
    this.table = options.table ?? 'reqon_execution_events';
    // The table name is interpolated into SQL (identifiers can't be bound), so
    // constrain it to a safe identifier to keep that interpolation injection-free.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.table)) {
      throw new Error(`Invalid table name: ${this.table}`);
    }
  }

  private async ensure(): Promise<PgPool> {
    if (this.pool) return this.pool;
    if (!this.ready) this.ready = this.init();
    return this.ready;
  }

  private async init(): Promise<PgPool> {
    let Pool: PgPoolCtor;
    try {
      // Non-literal specifier: keeps the driver an optional dependency with no
      // compile-time type coupling (no @types/pg required).
      const specifier = 'pg';
      const mod = (await import(specifier)) as {
        Pool?: PgPoolCtor;
        default?: { Pool?: PgPoolCtor };
      };
      const ctor = mod.Pool ?? mod.default?.Pool;
      if (!ctor) throw new Error('pg.Pool not found');
      Pool = ctor;
    } catch {
      throw new Error(
        "PostgresExecutionLog requires the optional peer dependency 'pg'. " +
          'Install it with: npm install pg'
      );
    }

    const pool = new Pool({ connectionString: this.connectionString });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
        execution_id text NOT NULL,
        seq integer NOT NULL,
        at text NOT NULL,
        data jsonb NOT NULL,
        PRIMARY KEY (execution_id, seq)
      )`
    );
    this.pool = pool;
    return pool;
  }

  async append(event: ExecutionEvent): Promise<StoredEvent> {
    const pool = await this.ensure();
    const at = new Date().toISOString();
    const data = JSON.stringify(event);

    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      try {
        const res = await pool.query<{ seq: number }>(
          `INSERT INTO ${this.table} (execution_id, seq, at, data)
           VALUES (
             $1,
             (SELECT COALESCE(MAX(seq) + 1, 0) FROM ${this.table} WHERE execution_id = $1),
             $2,
             $3::jsonb
           )
           RETURNING seq`,
          [event.executionId, at, data]
        );
        return { ...event, seq: res.rows[0].seq, at } as StoredEvent;
      } catch (err) {
        // A concurrent appender claimed this seq first; retry against the new max.
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) continue;
        throw err;
      }
    }
    throw new Error(
      `append failed after ${MAX_APPEND_ATTEMPTS} attempts for execution ${event.executionId}`
    );
  }

  async read(executionId: string): Promise<StoredEvent[]> {
    const pool = await this.ensure();
    const res = await pool.query<{ seq: number; at: string; data: ExecutionEvent }>(
      `SELECT seq, at, data FROM ${this.table} WHERE execution_id = $1 ORDER BY seq ASC`,
      [executionId]
    );
    // jsonb comes back already parsed; overlay the assigned seq + recorded time.
    return res.rows.map((r) => ({ ...r.data, seq: r.seq, at: r.at }));
  }

  async listCheckpoints(mission?: string): Promise<CheckpointRecord[]> {
    const pool = await this.ensure();
    const res = await pool.query<{ seq: number; at: string; data: ExecutionEvent }>(
      `SELECT seq, at, data FROM ${this.table} WHERE data->>'type' = 'checkpoint.advanced'`
    );
    const events = res.rows.map((r) => ({ ...r.data, seq: r.seq, at: r.at }) as StoredEvent);
    return reduceCheckpoints(events, mission);
  }

  async listPauses(): Promise<StoredEvent[]> {
    const pool = await this.ensure();
    const res = await pool.query<{ seq: number; at: string; data: ExecutionEvent }>(
      `SELECT seq, at, data FROM ${this.table}
       WHERE data->>'type' IN ('pause.created', 'pause.resumed')`
    );
    return res.rows.map((r) => ({ ...r.data, seq: r.seq, at: r.at }) as StoredEvent);
  }

  /** Drop all rows. Intended for test setup, not production use. */
  async reset(): Promise<void> {
    const pool = await this.ensure();
    await pool.query(`TRUNCATE ${this.table}`);
  }

  /** Release the connection pool. */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
      this.ready = undefined;
    }
  }
}
