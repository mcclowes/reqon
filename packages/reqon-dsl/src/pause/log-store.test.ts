import { describe, it, expect } from 'vitest';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { LogBackedPauseStore } from './log-store.js';
import { createPauseState } from './state.js';
import type { PauseState } from './state.js';

function makePause(overrides: Partial<PauseState> = {}): PauseState {
  const pause = createPauseState(
    overrides.executionId ?? 'exec-1',
    overrides.mission ?? 'M',
    overrides.duration ?? 7 * 24 * 60 * 60 * 1000,
    { stageIndex: 0, stepIndex: 1, action: 'A', variables: {} },
    [{ type: 'timeout', active: true }]
  );
  return { ...pause, ...overrides };
}

describe('LogBackedPauseStore', () => {
  it('round-trips a saved pause through the log', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedPauseStore(log);
    const pause = makePause();

    await store.save(pause);
    const loaded = await store.load(pause.id);

    expect(loaded?.id).toBe(pause.id);
    expect(loaded?.status).toBe('waiting');
    expect(loaded?.expiresAt).toBeInstanceOf(Date);
    expect(loaded?.expiresAt.getTime()).toBe(pause.expiresAt.getTime());
  });

  it('records a pause.created event on save', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedPauseStore(log);
    const pause = makePause({ executionId: 'exec-9' });

    await store.save(pause);

    const events = await log.read('exec-9');
    expect(events.map((e) => e.type)).toEqual(['pause.created']);
  });

  it('reflects an update as a pause.resumed event', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedPauseStore(log);
    const pause = makePause();
    await store.save(pause);

    await store.update(pause.id, {
      status: 'resumed',
      resumedBy: 'webhook',
      resumedAt: new Date('2026-03-01T00:00:00.000Z'),
      webhookPayload: { ok: true },
    });

    const loaded = await store.load(pause.id);
    expect(loaded?.status).toBe('resumed');
    expect(loaded?.resumedBy).toBe('webhook');
    expect(loaded?.resumedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(loaded?.webhookPayload).toEqual({ ok: true });
  });

  it('lists only waiting pauses as active', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedPauseStore(log);
    const a = makePause({ executionId: 'a' });
    const b = makePause({ executionId: 'b' });
    await store.save(a);
    await store.save(b);
    await store.update(b.id, { status: 'resumed', resumedBy: 'timeout' });

    const active = await store.listActive();
    expect(active.map((p) => p.id)).toEqual([a.id]);
  });

  it('finds a waiting pause by execution id', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedPauseStore(log);
    const pause = makePause({ executionId: 'exec-find' });
    await store.save(pause);

    const found = await store.loadByExecution('exec-find');
    expect(found?.id).toBe(pause.id);
  });

  it('reports a pause whose deadline has passed as expired', async () => {
    const log = new MemoryExecutionLog();
    const store = new LogBackedPauseStore(log);
    const past = makePause({ executionId: 'old' });
    past.expiresAt = new Date('2000-01-01T00:00:00.000Z');
    await store.save(past);

    const expired = await store.findExpired();
    expect(expired.map((p) => p.id)).toContain(past.id);
  });
});
