/**
 * Append-only storage for execution events. The contract: events for a given
 * execution are read back in append order with a contiguous `seq` starting at 0.
 */
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionEvent, StoredEvent } from './events.js';

export interface ExecutionLogStore {
  /** Append one event; returns it with its assigned seq and recorded timestamp. */
  append(event: ExecutionEvent): Promise<StoredEvent>;
  /** Read all events for an execution, in append order. */
  read(executionId: string): Promise<StoredEvent[]>;
}

/** In-memory execution log — for tests and ephemeral runs. */
export class MemoryExecutionLog implements ExecutionLogStore {
  private events: Map<string, StoredEvent[]> = new Map();

  async append(event: ExecutionEvent): Promise<StoredEvent> {
    const existing = this.events.get(event.executionId);
    const log = existing ?? [];
    const stored = { ...event, seq: log.length, at: new Date().toISOString() } as StoredEvent;
    log.push(stored);
    if (!existing) this.events.set(event.executionId, log);
    return stored;
  }

  async read(executionId: string): Promise<StoredEvent[]> {
    return [...(this.events.get(executionId) ?? [])];
  }
}

/**
 * Durable execution log: one append-only JSON-lines file per execution.
 *
 * Appends are O_APPEND single-line writes, so a crash mid-write can at worst
 * leave a torn final line, which {@link read} skips. The log therefore survives
 * a process restart — a resumed run reads its prior events back. (Single-process
 * for now; the transactional Postgres/SQLite backend is #138.)
 */
export class FileExecutionLog implements ExecutionLogStore {
  private dir: string;
  /** Cached next-seq per execution, lazily initialised from disk. */
  private counts: Map<string, number> = new Map();

  constructor(dir = '.reqon-data/execution-log') {
    this.dir = dir;
  }

  private pathFor(executionId: string): string {
    // executionId is runtime-generated (uuid); keep the filename simple/safe.
    const safe = executionId.replace(/[^A-Za-z0-9_.-]/g, '_');
    return join(this.dir, `${safe}.jsonl`);
  }

  async append(event: ExecutionEvent): Promise<StoredEvent> {
    await mkdir(this.dir, { recursive: true });

    let seq = this.counts.get(event.executionId);
    if (seq === undefined) {
      // First append this process: derive next seq from any persisted events.
      seq = (await this.read(event.executionId)).length;
    }

    const stored = { ...event, seq, at: new Date().toISOString() } as StoredEvent;
    await appendFile(this.pathFor(event.executionId), `${JSON.stringify(stored)}\n`, 'utf-8');
    this.counts.set(event.executionId, seq + 1);
    return stored;
  }

  async read(executionId: string): Promise<StoredEvent[]> {
    let content: string;
    try {
      content = await readFile(this.pathFor(executionId), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const events: StoredEvent[] = [];
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue;
      try {
        events.push(JSON.parse(line) as StoredEvent);
      } catch {
        // A torn trailing line from a crash mid-append — stop; the rest is intact.
        break;
      }
    }
    return events;
  }
}
