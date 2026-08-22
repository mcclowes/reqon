import { describe, it, expect } from 'vitest';
import { execute } from '../index.js';
import { MemoryExecutionLog } from '../execution-log/index.js';
import { LogBackedPauseStore } from '../pause/index.js';
import type { StoredEvent } from '../execution-log/index.js';

/**
 * Pause as a log view (#137): in durable mode the pause lives entirely in the
 * execution log — one `pause.created` carrying the full pause payload, no
 * separate pause file — so a paused run, and the timer it waits on, survive a
 * process restart and can be reconstructed from the log alone.
 */
describe('durable pause is a view over the execution log', () => {
  const pauseSource = `
    mission Waiter {
      source Api { auth: none, base: "https://api.example.test" }
      store out: memory("out")
      action Hold {
        pause {
          duration: "7d",
          resumeOn: timeout
        }
      }
      run Hold
    }
  `;

  it('records exactly one pause.created carrying the full pause payload', async () => {
    const log = new MemoryExecutionLog();
    const result = await execute(pauseSource, { executionLog: log });

    const events = await log.read(result.executionId!);
    const created = events.filter((e) => e.type === 'pause.created');
    expect(created).toHaveLength(1); // not double-emitted

    const event = created[0] as StoredEvent & {
      type: 'pause.created';
      pause?: Record<string, unknown>;
    };
    expect(event.pause).toBeDefined();
    expect(event.pause!.expiresAt).toBeDefined();
    expect(event.pause!.resumeTriggers).toBeDefined();
    expect(events.map((e) => e.type)).not.toContain('mission.completed');
  });

  it('reconstructs the waiting pause from the log after a restart', async () => {
    const log = new MemoryExecutionLog();
    const result = await execute(pauseSource, { executionLog: log });

    // Simulate a fresh process: a brand-new store over the same durable log.
    const restarted = new LogBackedPauseStore(log);
    const active = await restarted.listActive();

    expect(active).toHaveLength(1);
    expect(active[0].executionId).toBe(result.executionId);
    expect(active[0].mission).toBe('Waiter');
    expect(active[0].status).toBe('waiting');
    expect(active[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    const byExecution = await restarted.loadByExecution(result.executionId!);
    expect(byExecution?.id).toBe(active[0].id);
  });

  it('records pause.resumed when the paused run is resumed', async () => {
    const log = new MemoryExecutionLog();
    const first = await execute(pauseSource, { executionLog: log });

    const second = await execute(pauseSource, { executionLog: log, resumeFrom: first.executionId });
    expect(second.executionId).toBe(first.executionId);

    const types = (await log.read(first.executionId!)).map((e) => e.type);
    expect(types).toContain('pause.resumed');
  });
});
