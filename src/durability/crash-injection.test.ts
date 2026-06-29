import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { MissionExecutor } from '../interpreter/executor.js';
import { FileExecutionLog, foldLog } from '../execution-log/index.js';
import type { ExecutionLogStore } from '../execution-log/index.js';
import type { ExecutionEvent, StoredEvent } from '../execution-log/index.js';
import { FileStore } from '../stores/index.js';
import type { ReqonProgram, MissionDefinition, ActionStep } from '../ast/nodes.js';

/**
 * Crash-injection proof for the durable-execution foundation (#140).
 *
 * A durability product dies on a single data-loss report, so the claim must be
 * proven, not asserted. This suite runs a mission whose every step persists an
 * effect, then models a crash at each event boundary by persisting the log up
 * to that boundary and aborting — exactly the on-disk state a `kill -9` would
 * leave. It then resumes from the persisted log + store (fresh instances, as a
 * restarted process would) and asserts the final state is identical to an
 * uninterrupted run: no lost record, no duplicated effect.
 */

class CrashError extends Error {
  constructor() {
    super('injected crash');
    this.name = 'CrashError';
  }
}

/**
 * Wraps a real on-disk log and models process death at a chosen boundary: the
 * event that would take seq `crashAt` (and everything after) is never
 * persisted, and the abort propagates so no further events — not even
 * mission.failed — reach disk. The persisted log therefore holds exactly
 * seqs 0..crashAt-1, as after a kill -9 at that instant.
 */
class CrashAfterLog implements ExecutionLogStore {
  private crashed = false;
  constructor(
    private inner: ExecutionLogStore,
    private crashAt: number
  ) {}

  async append(event: ExecutionEvent): Promise<StoredEvent> {
    if (this.crashed) throw new CrashError();
    const nextSeq = (await this.inner.read(event.executionId)).length;
    if (nextSeq >= this.crashAt) {
      this.crashed = true;
      throw new CrashError();
    }
    return this.inner.append(event);
  }

  read(executionId: string): Promise<StoredEvent[]> {
    return this.inner.read(executionId);
  }
}

/** A store step that writes one keyed record. */
function storeStep(record: Record<string, unknown>): ActionStep {
  return {
    type: 'StoreStep',
    target: 'out',
    source: { type: 'Literal', value: record, dataType: 'object' },
    options: { key: { type: 'Identifier', name: 'id' } },
  } as unknown as ActionStep;
}

/** A mission that persists three keyed records across two actions. */
function program(): ReqonProgram {
  return {
    type: 'ReqonProgram',
    statements: [
      {
        type: 'MissionDefinition',
        name: 'Crashable',
        sources: [],
        stores: [{ type: 'StoreDefinition', name: 'out', target: 'out', storeType: 'file' }],
        schemas: [],
        transforms: [],
        actions: [
          {
            type: 'ActionDefinition',
            name: 'First',
            steps: [storeStep({ id: 'a', v: 1 }), storeStep({ id: 'b', v: 2 })],
          },
          {
            type: 'ActionDefinition',
            name: 'Second',
            steps: [storeStep({ id: 'c', v: 3 })],
          },
        ],
        pipeline: {
          type: 'PipelineDefinition',
          stages: [{ action: 'First' }, { action: 'Second' }],
        },
      } as unknown as MissionDefinition,
    ],
  };
}

/** The store's records, sorted by id, for stable comparison. */
async function storeContents(dir: string): Promise<Record<string, unknown>[]> {
  const out = new FileStore('out', { baseDir: join(dir, 'store') });
  const rows = await out.list();
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// Fixed id so the crash run and the resume run address the same execution
// (no executionStore is configured, so the id comes straight from resumeFrom).
const EXEC_ID = 'crash-exec';

/** Run until the injected crash at boundary `crashAt`; the run must abort. */
async function crashAt(dir: string, crashAt: number): Promise<void> {
  const log = new CrashAfterLog(new FileExecutionLog(join(dir, 'log')), crashAt);
  const out = new FileStore('out', { baseDir: join(dir, 'store') });
  await expect(
    new MissionExecutor({ executionLog: log, stores: { out }, resumeFrom: EXEC_ID }).execute(
      program()
    )
  ).rejects.toThrow(CrashError);
}

/** Resume the crashed execution from the persisted log + store (fresh instances). */
async function resume(dir: string): Promise<boolean> {
  const log = new FileExecutionLog(join(dir, 'log'));
  const out = new FileStore('out', { baseDir: join(dir, 'store') });
  const result = await new MissionExecutor({
    executionLog: log,
    stores: { out },
    resumeFrom: EXEC_ID,
  }).execute(program());
  return result.success;
}

/** An uninterrupted run under the fixed execution id (the baseline). */
async function runClean(dir: string): Promise<boolean> {
  const log = new FileExecutionLog(join(dir, 'log'));
  const out = new FileStore('out', { baseDir: join(dir, 'store') });
  const result = await new MissionExecutor({
    executionLog: log,
    stores: { out },
    resumeFrom: EXEC_ID,
  }).execute(program());
  return result.success;
}

async function readLog(dir: string): Promise<StoredEvent[]> {
  return new FileExecutionLog(join(dir, 'log')).read(EXEC_ID);
}

describe('crash-injection: durable execution survives a crash at any boundary', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reqon-crash-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('an uninterrupted run persists every record to the on-disk store', async () => {
    const log = new FileExecutionLog(join(dir, 'log'));
    const out = new FileStore('out', { baseDir: join(dir, 'store') });
    const result = await new MissionExecutor({ executionLog: log, stores: { out } }).execute(
      program()
    );

    expect(result.success).toBe(true);
    const records = await storeContents(dir);
    expect(records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('crashing mid-run then resuming reaches the same final state', async () => {
    // Boundary 3 = after mission.started, First#0.started, First#0.effect.applied.
    await crashAt(dir, 3);

    // Resume picks up the persisted log and store and runs to completion.
    expect(await resume(dir)).toBe(true);

    const records = await storeContents(dir);
    expect(records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('survives a crash at EVERY boundary: no lost record, no duplicated effect', async () => {
    // Establish the uninterrupted baseline and its event count.
    const baseDir = await mkdtemp(join(tmpdir(), 'reqon-crash-base-'));
    try {
      expect(await runClean(baseDir)).toBe(true);
      const baseline = (await storeContents(baseDir)).map((r) => r.id);
      const totalEvents = (await readLog(baseDir)).length;
      expect(totalEvents).toBeGreaterThan(3);

      // Crash after persisting each prefix 1..totalEvents-1, then resume.
      for (let crashPoint = 1; crashPoint < totalEvents; crashPoint++) {
        const d = await mkdtemp(join(tmpdir(), `reqon-crash-${crashPoint}-`));
        try {
          await crashAt(d, crashPoint);
          expect(await resume(d)).toBe(true);

          // No lost record / no extra record: final state equals the baseline.
          const records = (await storeContents(d)).map((r) => r.id);
          expect(records, `final state after crash@${crashPoint}`).toEqual(baseline);

          // No duplicated effect: each effectId is recorded applied at most once.
          const applied = (await readLog(d))
            .filter((e) => e.type === 'effect.applied')
            .map((e) => (e as StoredEvent & { effectId: string }).effectId);
          expect(new Set(applied).size, `duplicate effect after crash@${crashPoint}`).toBe(
            applied.length
          );
        } finally {
          await rm(d, { recursive: true, force: true });
        }
      }
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('ignores a torn final log line from a mid-write crash and resumes cleanly', async () => {
    await crashAt(dir, 4);

    // Model a kill -9 mid-append: a partial, unterminated JSON line at the tail.
    const logFile = join(dir, 'log', `${EXEC_ID}.jsonl`);
    await appendFile(logFile, '{"type":"step.started","executionId":"crash-exec","st');

    // Resume must skip the torn line, replay the intact prefix, and complete.
    expect(await resume(dir)).toBe(true);
    expect((await storeContents(dir)).map((r) => r.id)).toEqual(['a', 'b', 'c']);

    // The log itself must remain coherent: the events the resume appended must
    // not have been concatenated onto the torn line. It must fold to completed.
    expect(foldLog(await readLog(dir)).status).toBe('completed');
  });
});
