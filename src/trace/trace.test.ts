import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDuration,
  formatDuration,
  createPauseState,
  isPauseExpired,
  getRemainingTime,
} from '../pause/state.js';
import { MemoryPauseStore } from '../pause/store.js';
import { createExecutionTrace, safeClone, truncateForTrace, generateSnapshotId } from './state.js';
import { MemoryTraceStore } from './store.js';
import { TraceReplayer } from './replay.js';

describe('Trace State', () => {
  it('creates execution trace', () => {
    const trace = createExecutionTrace('exec-1', 'TestMission', 'full');
    expect(trace.id).toBe('exec-1');
    expect(trace.mission).toBe('TestMission');
    expect(trace.mode).toBe('full');
    expect(trace.snapshots).toEqual([]);
    expect(trace.startedAt).toBeInstanceOf(Date);
  });

  it('generates snapshot IDs', () => {
    const id = generateSnapshotId('exec-1', 5);
    expect(id).toBe('exec-1_snap_000005');
  });

  it('safely clones values', () => {
    const original = {
      name: 'test',
      nested: { value: 42 },
      array: [1, 2, 3],
    };
    const cloned = safeClone(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
  });

  it('handles circular references in clone', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const cloned = safeClone(obj);
    expect(cloned.name).toBe('test');
    expect(cloned.self).toBe('[circular reference]');
  });

  it('truncates large arrays', () => {
    const largeArray = Array.from({ length: 200 }, (_, i) => i);
    const truncated = truncateForTrace(largeArray, 50) as unknown[];
    expect(truncated.length).toBe(51);
    expect(truncated[50]).toContain('truncated');
  });

  it('truncates long strings', () => {
    const longString = 'a'.repeat(2000);
    const truncated = truncateForTrace(longString, 100, 500) as string;
    expect(truncated.length).toBeLessThan(longString.length);
    expect(truncated).toContain('truncated');
  });
});

describe('MemoryTraceStore', () => {
  let store: MemoryTraceStore;

  beforeEach(() => {
    store = new MemoryTraceStore();
  });

  it('saves and loads traces', async () => {
    const trace = createExecutionTrace('exec-1', 'TestMission', 'full');
    trace.snapshots.push({
      id: generateSnapshotId('exec-1', 0),
      index: 0,
      timestamp: new Date(),
      mission: 'TestMission',
      action: 'FetchData',
      stepIndex: 0,
      stepType: 'fetch',
      phase: 'before',
      variables: { foo: 'bar' },
      stores: {},
    });

    await store.save(trace);

    const loaded = await store.load('exec-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('exec-1');
    expect(loaded!.snapshots).toHaveLength(1);
  });

  it('lists traces by mission', async () => {
    await store.save(createExecutionTrace('exec-1', 'MissionA', 'full'));
    await store.save(createExecutionTrace('exec-2', 'MissionA', 'full'));
    await store.save(createExecutionTrace('exec-3', 'MissionB', 'full'));

    const missionATraces = await store.listByMission('MissionA');
    expect(missionATraces).toHaveLength(2);
  });

  it('finds latest trace', async () => {
    const trace1 = createExecutionTrace('exec-1', 'TestMission', 'full');
    trace1.startedAt = new Date('2024-01-01');
    await store.save(trace1);

    const trace2 = createExecutionTrace('exec-2', 'TestMission', 'full');
    trace2.startedAt = new Date('2024-01-02');
    await store.save(trace2);

    const latest = await store.findLatest('TestMission');
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe('exec-2');
  });
});

describe('TraceReplayer', () => {
  let store: MemoryTraceStore;
  let replayer: TraceReplayer;

  beforeEach(async () => {
    store = new MemoryTraceStore();
    replayer = new TraceReplayer(store);

    // Create a sample trace
    const trace = createExecutionTrace('exec-1', 'TestMission', 'full');
    trace.snapshots = [
      {
        id: 'snap-0',
        index: 0,
        timestamp: new Date(),
        mission: 'TestMission',
        action: 'FetchData',
        stepIndex: 0,
        stepType: 'fetch',
        phase: 'before',
        variables: { page: 1 },
        stores: {},
      },
      {
        id: 'snap-1',
        index: 1,
        timestamp: new Date(),
        mission: 'TestMission',
        action: 'FetchData',
        stepIndex: 0,
        stepType: 'fetch',
        phase: 'after',
        variables: { page: 1, response: { items: [] } },
        stores: {},
        stepDuration: 100,
      },
      {
        id: 'snap-2',
        index: 2,
        timestamp: new Date(),
        mission: 'TestMission',
        action: 'ProcessData',
        stepIndex: 0,
        stepType: 'map',
        phase: 'before',
        variables: { page: 2 },
        stores: {},
      },
    ];
    await store.save(trace);
  });

  it('loads and navigates trace', async () => {
    const session = await replayer.loadTrace('exec-1');
    expect(session.trace.id).toBe('exec-1');
    expect(session.totalSnapshots).toBe(3);
    expect(session.currentIndex).toBe(0);
  });

  it('steps through trace', async () => {
    await replayer.loadTrace('exec-1');

    const step1 = await replayer.next();
    expect(step1).not.toBeNull();
    expect(step1!.snapshot.index).toBe(1);

    const step2 = await replayer.next();
    expect(step2).not.toBeNull();
    expect(step2!.snapshot.index).toBe(2);

    const step3 = await replayer.next();
    expect(step3).toBeNull(); // No more steps
  });

  it('goes to specific step', async () => {
    await replayer.loadTrace('exec-1');

    const result = await replayer.goToStep(2);
    expect(result.snapshot.index).toBe(2);
    expect(result.hasNext).toBe(false);
    expect(result.hasPrevious).toBe(true);
  });

  it('compares snapshots', async () => {
    await replayer.loadTrace('exec-1');

    const diff = replayer.compareSnapshots(0, 1);
    expect(diff.variableChanges).toContainEqual(
      expect.objectContaining({
        name: 'response',
        type: 'added',
      })
    );
  });

  it('gets timeline events', async () => {
    await replayer.loadTrace('exec-1');

    const timeline = replayer.getTimeline();
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.some((e) => e.type === 'action-start')).toBe(true);
  });
});
