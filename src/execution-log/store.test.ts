import { describe, it, expect } from 'vitest';
import { MemoryExecutionLog } from './store.js';

describe('MemoryExecutionLog', () => {
  it('appends events and reads them back in order with contiguous seq', async () => {
    const log = new MemoryExecutionLog();

    await log.append({ executionId: 'e1', type: 'mission.started', mission: 'M' });
    await log.append({ executionId: 'e1', type: 'step.completed', stepId: 's0', attempt: 0 });

    const events = await log.read('e1');
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
    expect(events.map((e) => e.type)).toEqual(['mission.started', 'step.completed']);
    expect(events[0].at).toBeTypeOf('string');
  });

  it('keeps executions isolated', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'a', type: 'mission.started', mission: 'A' });
    await log.append({ executionId: 'b', type: 'mission.started', mission: 'B' });

    expect(await log.read('a')).toHaveLength(1);
    expect((await log.read('b'))[0].seq).toBe(0);
  });

  it('returns a copy so reads cannot mutate the log', async () => {
    const log = new MemoryExecutionLog();
    await log.append({ executionId: 'e', type: 'mission.started', mission: 'M' });
    const first = await log.read('e');
    first.push({} as never);
    expect(await log.read('e')).toHaveLength(1);
  });
});
