import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExecutionLog } from './store.js';
import { foldLog } from './fold.js';

describe('FileExecutionLog durability', () => {
  const dirs: string[] = [];
  const freshDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'reqon-elog-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('persists events across a restart (a new instance reads them back)', async () => {
    const dir = freshDir();
    const first = new FileExecutionLog(dir);
    await first.append({ executionId: 'e1', type: 'mission.started', mission: 'M' });
    await first.append({ executionId: 'e1', type: 'step.completed', stepId: 's0', attempt: 0 });

    // Simulate a process restart: a brand-new instance over the same dir.
    const resumed = new FileExecutionLog(dir);
    const events = await resumed.read('e1');
    expect(events.map((e) => e.seq)).toEqual([0, 1]);

    // And it continues the sequence rather than restarting it.
    const next = await resumed.append({
      executionId: 'e1',
      type: 'mission.completed',
    });
    expect(next.seq).toBe(2);
    expect(foldLog(await resumed.read('e1')).status).toBe('completed');
  });

  it('tolerates a torn final line from a crash mid-append', async () => {
    const dir = freshDir();
    const log = new FileExecutionLog(dir);
    await log.append({ executionId: 'e2', type: 'mission.started', mission: 'M' });

    // Append a partial (un-terminated, unparseable) line as a crash would leave.
    const file = join(dir, 'e2.jsonl');
    writeFileSync(file, `{"executionId":"e2","type":"step.completed","stepId":"s0","attempt":0`, {
      flag: 'a',
    });

    const events = await log.read('e2');
    expect(events).toHaveLength(1); // torn line skipped, intact event survives
    expect(events[0].type).toBe('mission.started');
  });

  it('creates log files owner-only (0o600) — they can hold resume state', async () => {
    const dir = freshDir();
    const log = new FileExecutionLog(dir);
    await log.append({ executionId: 'e3', type: 'mission.started', mission: 'M' });

    const mode = statSync(join(dir, 'e3.jsonl')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
