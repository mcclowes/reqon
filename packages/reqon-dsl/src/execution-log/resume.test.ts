import { describe, it, expect } from 'vitest';
import { MemoryExecutionLog } from './store.js';
import { loadState } from './resume.js';
import { effectId } from './events.js';

/**
 * A side effect guarded by the log: apply once, record an effect.applied event,
 * and skip on any later replay. This is the exactly-once-on-resume primitive
 * the executor will build on.
 */
async function applyOnce(
  store: MemoryExecutionLog,
  executionId: string,
  stepId: string,
  attempt: number,
  discriminator: string,
  run: () => void
): Promise<void> {
  const id = effectId(executionId, stepId, attempt, 'store', discriminator);
  const state = await loadState(store, executionId);
  if (state.appliedEffects.has(id)) return; // already applied before the crash
  run();
  await store.append({
    executionId,
    type: 'effect.applied',
    stepId,
    attempt,
    effectType: 'store',
    effectId: id,
  });
}

describe('idempotent resume via the execution log', () => {
  it('applies a logged effect exactly once across a simulated crash + resume', async () => {
    const log = new MemoryExecutionLog();
    const applied: string[] = [];

    // First run applies the effect and records it.
    await applyOnce(log, 'e1', 's0', 0, 'rec-1', () => applied.push('rec-1'));

    // Crash + resume: the same effect is attempted again from the start.
    await applyOnce(log, 'e1', 's0', 0, 'rec-1', () => applied.push('rec-1'));

    expect(applied).toEqual(['rec-1']); // ran once, skipped on resume
  });

  it('still applies a genuinely different effect', async () => {
    const log = new MemoryExecutionLog();
    const applied: string[] = [];

    await applyOnce(log, 'e1', 's0', 0, 'rec-1', () => applied.push('rec-1'));
    await applyOnce(log, 'e1', 's1', 0, 'rec-2', () => applied.push('rec-2'));

    expect(applied).toEqual(['rec-1', 'rec-2']);
  });
});
