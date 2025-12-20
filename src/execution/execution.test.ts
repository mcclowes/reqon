import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import {
  createExecutionState,
  findResumePoint,
  canResume,
  getProgress,
  getExecutionSummary,
  type ExecutionState,
} from './state.js';
import { FileExecutionStore, MemoryExecutionStore } from './store.js';

const TEST_DIR = '.reqon-test-executions';

describe('ExecutionState', () => {
  describe('createExecutionState', () => {
    it('creates initial state with pending stages', () => {
      const state = createExecutionState({
        mission: 'TestMission',
        stages: ['FetchData', 'ProcessData', 'StoreResults'],
      });

      expect(state.mission).toBe('TestMission');
      expect(state.status).toBe('pending');
      expect(state.stages).toHaveLength(3);
      expect(state.stages[0].action).toBe('FetchData');
      expect(state.stages[0].status).toBe('pending');
      expect(state.id).toMatch(/^exec_/);
    });

    it('includes metadata', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A'],
        metadata: { tenant: 'acme', userId: '123' },
      });

      expect(state.metadata).toEqual({ tenant: 'acme', userId: '123' });
    });
  });

  describe('findResumePoint', () => {
    it('returns 0 for fresh execution', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B', 'C'],
      });

      expect(findResumePoint(state)).toBe(0);
    });

    it('returns index of first non-completed stage', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B', 'C'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'failed';

      expect(findResumePoint(state)).toBe(1);
    });

    it('returns -1 when all stages complete', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'completed';

      expect(findResumePoint(state)).toBe(-1);
    });

    it('skips over skipped stages', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B', 'C'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'skipped';

      expect(findResumePoint(state)).toBe(2);
    });
  });

  describe('canResume', () => {
    it('returns true for failed executions', () => {
      const state = createExecutionState({ mission: 'Test', stages: ['A'] });
      state.status = 'failed';
      expect(canResume(state)).toBe(true);
    });

    it('returns true for paused executions', () => {
      const state = createExecutionState({ mission: 'Test', stages: ['A'] });
      state.status = 'paused';
      expect(canResume(state)).toBe(true);
    });

    it('returns false for completed executions', () => {
      const state = createExecutionState({ mission: 'Test', stages: ['A'] });
      state.status = 'completed';
      expect(canResume(state)).toBe(false);
    });

    it('returns false for running executions', () => {
      const state = createExecutionState({ mission: 'Test', stages: ['A'] });
      state.status = 'running';
      expect(canResume(state)).toBe(false);
    });
  });

  describe('getProgress', () => {
    it('returns 0 for no completed stages', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B', 'C', 'D'],
      });
      expect(getProgress(state)).toBe(0);
    });

    it('returns 50 for half completed', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B', 'C', 'D'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'completed';
      expect(getProgress(state)).toBe(50);
    });

    it('returns 100 for all completed', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'completed';
      expect(getProgress(state)).toBe(100);
    });

    it('counts skipped as progress', () => {
      const state = createExecutionState({
        mission: 'Test',
        stages: ['A', 'B'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'skipped';
      expect(getProgress(state)).toBe(100);
    });
  });

  describe('getExecutionSummary', () => {
    it('generates readable summary', () => {
      const state = createExecutionState({
        mission: 'SyncInvoices',
        stages: ['Fetch', 'Process', 'Store'],
      });
      state.stages[0].status = 'completed';
      state.stages[1].status = 'failed';
      state.status = 'failed';

      const summary = getExecutionSummary(state);
      expect(summary).toContain('SyncInvoices');
      expect(summary).toContain('failed');
      expect(summary).toContain('1 completed');
      expect(summary).toContain('1 failed');
      expect(summary).toContain('1 pending');
    });
  });
});

describe('MemoryExecutionStore', () => {
  let store: MemoryExecutionStore;

  beforeEach(() => {
    store = new MemoryExecutionStore();
  });

  it('saves and loads execution state', async () => {
    const state = createExecutionState({
      mission: 'Test',
      stages: ['A', 'B'],
    });

    await store.save(state);
    const loaded = await store.load(state.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(state.id);
    expect(loaded!.mission).toBe('Test');
  });

  it('returns null for unknown ID', async () => {
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('lists by mission', async () => {
    const state1 = createExecutionState({ mission: 'A', stages: ['X'] });
    const state2 = createExecutionState({ mission: 'B', stages: ['X'] });
    const state3 = createExecutionState({ mission: 'A', stages: ['X'] });

    await store.save(state1);
    await store.save(state2);
    await store.save(state3);

    const aExecutions = await store.listByMission('A');
    expect(aExecutions).toHaveLength(2);
  });

  it('finds resumable executions', async () => {
    const completed = createExecutionState({ mission: 'Test', stages: ['A'] });
    completed.status = 'completed';

    const failed = createExecutionState({ mission: 'Test', stages: ['A'] });
    failed.status = 'failed';

    const paused = createExecutionState({ mission: 'Test', stages: ['A'] });
    paused.status = 'paused';

    await store.save(completed);
    await store.save(failed);
    await store.save(paused);

    const resumable = await store.findResumable('Test');
    expect(resumable).toHaveLength(2);
  });

  it('deletes execution state', async () => {
    const state = createExecutionState({ mission: 'Test', stages: ['A'] });
    await store.save(state);
    await store.delete(state.id);

    const loaded = await store.load(state.id);
    expect(loaded).toBeNull();
  });
});

describe('FileExecutionStore', () => {
  let store: FileExecutionStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    store = new FileExecutionStore(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('creates directory if not exists', () => {
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('persists state to disk', async () => {
    const state = createExecutionState({
      mission: 'Persistent',
      stages: ['A', 'B'],
    });
    state.stages[0].status = 'completed';

    await store.save(state);

    // Create new store instance
    const newStore = new FileExecutionStore(TEST_DIR);
    const loaded = await newStore.load(state.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.stages[0].status).toBe('completed');
  });

  it('preserves Date objects', async () => {
    const state = createExecutionState({
      mission: 'Test',
      stages: ['A'],
    });
    state.stages[0].startedAt = new Date();
    state.stages[0].completedAt = new Date();

    await store.save(state);
    const loaded = await store.load(state.id);

    expect(loaded!.startedAt).toBeInstanceOf(Date);
    expect(loaded!.stages[0].startedAt).toBeInstanceOf(Date);
    expect(loaded!.stages[0].completedAt).toBeInstanceOf(Date);
  });

  it('finds latest execution for mission', async () => {
    const older = createExecutionState({ mission: 'Test', stages: ['A'] });
    older.startedAt = new Date(Date.now() - 10000);

    const newer = createExecutionState({ mission: 'Test', stages: ['A'] });
    newer.startedAt = new Date();

    await store.save(older);
    await store.save(newer);

    const latest = await store.findLatest('Test');
    expect(latest!.id).toBe(newer.id);
  });
});
