/**
 * Log-backed pause store: resource-free long pauses as a view over the
 * execution log.
 *
 * In durable mode the execution log holds the full pause record — a
 * `pause.created` event carries the pause state (deadline, resume triggers,
 * captured checkpoint), and `pause.resumed` records how and when it ended. A
 * paused run, and the timer or webhook it waits on, are therefore reconstructable
 * from the log alone, with no separate pause file. This adapter folds those
 * events back into {@link PauseState}.
 */
import type { ExecutionLogStore } from '../execution-log/index.js';
import type { StoredEvent } from '../execution-log/index.js';
import type { PauseStore } from './store.js';
import type { PauseState } from './state.js';

/** Coerce a value that may be a Date or an ISO string back to a Date. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function restoreDates(pause: PauseState): PauseState {
  pause.pausedAt = toDate(pause.pausedAt);
  pause.expiresAt = toDate(pause.expiresAt);
  if (pause.resumedAt) pause.resumedAt = toDate(pause.resumedAt);
  return pause;
}

export class LogBackedPauseStore implements PauseStore {
  constructor(private log: ExecutionLogStore) {}

  async save(pause: PauseState): Promise<void> {
    await this.log.append({
      executionId: pause.executionId,
      type: 'pause.created',
      pauseId: pause.id,
      pause,
    });
  }

  async update(id: string, updates: Partial<PauseState>): Promise<void> {
    const pause = await this.load(id);
    if (!pause) throw new Error(`Pause not found: ${id}`);
    const resumedBy = updates.resumedBy ?? 'manual';
    await this.log.append({
      executionId: pause.executionId,
      type: 'pause.resumed',
      pauseId: id,
      resumedBy,
      status: (updates.status as 'resumed' | 'cancelled' | 'expired') ?? 'resumed',
      resumedAt: (updates.resumedAt ?? new Date()).toISOString(),
      webhookPayload: updates.webhookPayload,
    });
  }

  async load(id: string): Promise<PauseState | null> {
    const byId = this.foldPauses(await this.log.listPauses());
    return byId.get(id) ?? null;
  }

  async loadByExecution(executionId: string): Promise<PauseState | null> {
    const all = this.foldPauses(await this.log.listPauses());
    for (const pause of all.values()) {
      if (pause.executionId === executionId && pause.status === 'waiting') return pause;
    }
    return null;
  }

  async listActive(): Promise<PauseState[]> {
    return (await this.allPauses())
      .filter((p) => p.status === 'waiting')
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }

  async listByMission(mission: string): Promise<PauseState[]> {
    return (await this.allPauses())
      .filter((p) => p.mission === mission)
      .sort((a, b) => b.pausedAt.getTime() - a.pausedAt.getTime());
  }

  async findExpired(): Promise<PauseState[]> {
    const now = new Date();
    return (await this.listActive()).filter((p) => p.expiresAt <= now);
  }

  /** Append-only: deletion is a no-op (history is retained in the log). */
  async delete(): Promise<void> {}

  private async allPauses(): Promise<PauseState[]> {
    return Array.from(this.foldPauses(await this.log.listPauses()).values());
  }

  /**
   * Fold pause events into the latest state per pause id. A `pause.created`
   * seeds the state; later `pause.resumed` events apply the terminal status.
   */
  private foldPauses(events: StoredEvent[]): Map<string, PauseState> {
    const byId = new Map<string, PauseState>();

    for (const event of events) {
      if (event.type === 'pause.created' && event.pause) {
        byId.set(event.pauseId, restoreDates({ ...(event.pause as PauseState) }));
      }
    }
    // Apply resumptions after every create is loaded (events aren't ordered).
    for (const event of events) {
      if (event.type !== 'pause.resumed') continue;
      const pause = byId.get(event.pauseId);
      if (!pause) continue;
      pause.status = event.status ?? 'resumed';
      pause.resumedBy = event.resumedBy as PauseState['resumedBy'];
      if (event.resumedAt) pause.resumedAt = new Date(event.resumedAt);
      if (event.webhookPayload !== undefined) pause.webhookPayload = event.webhookPayload;
    }
    return byId;
  }
}
