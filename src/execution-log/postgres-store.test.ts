import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresExecutionLog } from './postgres-store.js';
import type { ExecutionEvent } from './events.js';

/**
 * Contract tests for the Postgres execution-log backend. They need a real
 * database, so they are gated on DATABASE_URL and skip otherwise (locally);
 * CI runs them against a Postgres service container. The suite mirrors the
 * SQLite contract and adds a concurrency case — distinct, contiguous seqs
 * under concurrent appenders — which is the multi-node reason Postgres exists.
 */
const DB = process.env.DATABASE_URL;

const started = (executionId: string): ExecutionEvent => ({
  type: 'mission.started',
  executionId,
  mission: 'M',
});

let counter = 0;
const freshId = () => `pg-exec-${++counter}`;

describe.skipIf(!DB)('PostgresExecutionLog', () => {
  let log: PostgresExecutionLog;

  beforeAll(async () => {
    log = new PostgresExecutionLog(DB!);
    // Start from a clean table so seq assertions are deterministic.
    await log.reset();
  });

  afterAll(async () => {
    await log.close();
  });

  it('assigns contiguous seq from 0 and reads events back in append order', async () => {
    const id = freshId();
    const a = await log.append(started(id));
    const b = await log.append({ type: 'mission.completed', executionId: id });

    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(typeof a.at).toBe('string');

    const events = await log.read(id);
    expect(events.map((e) => e.type)).toEqual(['mission.started', 'mission.completed']);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('survives a fresh connection to the same database', async () => {
    const id = freshId();
    await log.append(started(id));
    await log.append({ type: 'step.completed', executionId: id, stepId: 'A#0', attempt: 0 });

    // A second client (as a restarted process) reads the prior events back.
    const reopened = new PostgresExecutionLog(DB!);
    try {
      const events = await reopened.read(id);
      expect(events.map((e) => e.type)).toEqual(['mission.started', 'step.completed']);
    } finally {
      await reopened.close();
    }
  });

  it('continues seq numbering for an execution rather than resetting to 0', async () => {
    const id = freshId();
    await log.append(started(id));
    const next = await log.append({ type: 'mission.completed', executionId: id });
    expect(next.seq).toBe(1);
  });

  it('isolates events by executionId', async () => {
    const a = freshId();
    const b = freshId();
    await log.append(started(a));
    await log.append(started(b));
    await log.append({ type: 'mission.completed', executionId: a });

    expect((await log.read(a)).map((e) => e.type)).toEqual([
      'mission.started',
      'mission.completed',
    ]);
    expect((await log.read(b)).map((e) => e.seq)).toEqual([0]);
  });

  it('assigns distinct, contiguous seqs under concurrent appenders', async () => {
    const id = freshId();
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        log.append({ type: 'step.completed', executionId: id, stepId: `s${i}`, attempt: 0 })
      )
    );

    const seqs = (await log.read(id)).map((e) => e.seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i)); // 0..N-1, no gaps, no dups
  });
});
