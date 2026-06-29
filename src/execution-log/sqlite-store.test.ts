import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { SqliteExecutionLog } from './sqlite-store.js';
import type { ExecutionEvent } from './events.js';

const started = (executionId: string): ExecutionEvent => ({
  type: 'mission.started',
  executionId,
  mission: 'M',
});

describe('SqliteExecutionLog', () => {
  let path: string;

  beforeEach(() => {
    path = join(tmpdir(), `reqon-log-${process.pid}-${Date.now()}.sqlite`);
  });

  afterEach(async () => {
    await rm(path, { force: true });
  });

  it('assigns contiguous seq from 0 and reads events back in append order', async () => {
    const log = new SqliteExecutionLog(path);

    const a = await log.append(started('exec-1'));
    const b = await log.append({ type: 'mission.completed', executionId: 'exec-1' });

    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(typeof a.at).toBe('string');

    const events = await log.read('exec-1');
    expect(events.map((e) => e.type)).toEqual(['mission.started', 'mission.completed']);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('survives a reopen: a fresh instance on the same file reads prior events', async () => {
    const first = new SqliteExecutionLog(path);
    await first.append(started('exec-2'));
    await first.append({
      type: 'step.completed',
      executionId: 'exec-2',
      stepId: 'A#0',
      attempt: 0,
    });

    // Simulate a process restart: brand new instance, same file.
    const reopened = new SqliteExecutionLog(path);
    const events = await reopened.read('exec-2');

    expect(events.map((e) => e.type)).toEqual(['mission.started', 'step.completed']);
  });

  it('continues seq numbering across a reopen rather than resetting to 0', async () => {
    const first = new SqliteExecutionLog(path);
    await first.append(started('exec-3'));

    const reopened = new SqliteExecutionLog(path);
    const next = await reopened.append({ type: 'mission.completed', executionId: 'exec-3' });

    expect(next.seq).toBe(1);
  });

  it('isolates events by executionId', async () => {
    const log = new SqliteExecutionLog(path);
    await log.append(started('a'));
    await log.append(started('b'));
    await log.append({ type: 'mission.completed', executionId: 'a' });

    expect((await log.read('a')).map((e) => e.type)).toEqual([
      'mission.started',
      'mission.completed',
    ]);
    expect((await log.read('b')).map((e) => e.seq)).toEqual([0]);
  });
});
