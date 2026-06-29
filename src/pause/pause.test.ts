import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseDuration,
  formatDuration,
  createPauseState,
  isPauseExpired,
  getRemainingTime,
} from './state.js';
import { MemoryPauseStore } from './store.js';
import { PauseManager } from './manager.js';

describe('Pause State', () => {
  describe('parseDuration', () => {
    it('parses days', () => {
      expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    });

    it('parses hours', () => {
      expect(parseDuration('12h')).toBe(12 * 60 * 60 * 1000);
      expect(parseDuration('1h')).toBe(60 * 60 * 1000);
    });

    it('parses minutes', () => {
      expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    });

    it('parses seconds', () => {
      expect(parseDuration('45s')).toBe(45 * 1000);
    });

    it('parses raw milliseconds', () => {
      expect(parseDuration(5000)).toBe(5000);
      expect(parseDuration('5000ms')).toBe(5000);
    });

    it('throws on invalid format', () => {
      expect(() => parseDuration('invalid')).toThrow();
    });
  });

  describe('formatDuration', () => {
    it('formats days', () => {
      expect(formatDuration(7 * 24 * 60 * 60 * 1000)).toBe('7.0d');
    });

    it('formats hours', () => {
      expect(formatDuration(12 * 60 * 60 * 1000)).toBe('12.0h');
    });

    it('formats minutes', () => {
      expect(formatDuration(30 * 60 * 1000)).toBe('30.0m');
    });

    it('formats seconds', () => {
      expect(formatDuration(45 * 1000)).toBe('45.0s');
    });
  });

  describe('createPauseState', () => {
    it('creates pause state with correct properties', () => {
      const checkpoint = {
        stageIndex: 1,
        stepIndex: 2,
        action: 'TestAction',
        variables: { foo: 'bar' },
      };

      const pause = createPauseState('exec-123', 'TestMission', 60000, checkpoint, [
        { type: 'timeout', active: true },
      ]);

      expect(pause.executionId).toBe('exec-123');
      expect(pause.mission).toBe('TestMission');
      expect(pause.duration).toBe(60000);
      expect(pause.status).toBe('waiting');
      expect(pause.checkpoint).toEqual(checkpoint);
    });

    it('sets correct expiration time', () => {
      const now = Date.now();
      const pause = createPauseState(
        'exec-123',
        'TestMission',
        60000,
        { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
        []
      );

      const expectedExpiration = now + 60000;
      expect(Math.abs(pause.expiresAt.getTime() - expectedExpiration)).toBeLessThan(100);
    });
  });

  describe('isPauseExpired', () => {
    it('returns false for non-expired pause', () => {
      const pause = createPauseState(
        'exec-123',
        'TestMission',
        60000,
        { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
        []
      );
      expect(isPauseExpired(pause)).toBe(false);
    });

    it('returns true for expired pause', () => {
      const pause = createPauseState(
        'exec-123',
        'TestMission',
        -1000, // Already expired
        { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
        []
      );
      expect(isPauseExpired(pause)).toBe(true);
    });

    it('returns false for already resumed pause', () => {
      const pause = createPauseState(
        'exec-123',
        'TestMission',
        -1000,
        { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
        []
      );
      pause.status = 'resumed';
      expect(isPauseExpired(pause)).toBe(false);
    });
  });

  describe('getRemainingTime', () => {
    it('returns positive value for non-expired pause', () => {
      const pause = createPauseState(
        'exec-123',
        'TestMission',
        60000,
        { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
        []
      );
      const remaining = getRemainingTime(pause);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60000);
    });

    it('returns 0 for expired pause', () => {
      const pause = createPauseState(
        'exec-123',
        'TestMission',
        -1000,
        { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
        []
      );
      expect(getRemainingTime(pause)).toBe(0);
    });
  });
});

describe('MemoryPauseStore', () => {
  let store: MemoryPauseStore;

  beforeEach(() => {
    store = new MemoryPauseStore();
  });

  it('saves and loads pause', async () => {
    const pause = createPauseState(
      'exec-123',
      'TestMission',
      60000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      [{ type: 'timeout', active: true }]
    );

    await store.save(pause);

    const loaded = await store.load(pause.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.executionId).toBe('exec-123');
  });

  it('loads by execution ID', async () => {
    const pause = createPauseState(
      'exec-123',
      'TestMission',
      60000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      []
    );

    await store.save(pause);

    const loaded = await store.loadByExecution('exec-123');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(pause.id);
  });

  it('lists active pauses', async () => {
    const pause1 = createPauseState(
      'exec-1',
      'Mission1',
      60000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      []
    );
    const pause2 = createPauseState(
      'exec-2',
      'Mission2',
      60000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      []
    );
    pause2.status = 'resumed';

    await store.save(pause1);
    await store.save(pause2);

    const active = await store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].executionId).toBe('exec-1');
  });

  it('finds expired pauses', async () => {
    const expired = createPauseState(
      'exec-1',
      'Mission1',
      -1000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      []
    );
    const active = createPauseState(
      'exec-2',
      'Mission2',
      60000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      []
    );

    await store.save(expired);
    await store.save(active);

    const expiredList = await store.findExpired();
    expect(expiredList).toHaveLength(1);
    expect(expiredList[0].executionId).toBe('exec-1');
  });

  it('updates pause', async () => {
    const pause = createPauseState(
      'exec-123',
      'TestMission',
      60000,
      { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
      []
    );

    await store.save(pause);
    await store.update(pause.id, { status: 'resumed', resumedBy: 'manual' });

    const loaded = await store.load(pause.id);
    expect(loaded!.status).toBe('resumed');
    expect(loaded!.resumedBy).toBe('manual');
  });
});

describe('PauseManager', () => {
  let store: MemoryPauseStore;
  let manager: PauseManager;

  beforeEach(() => {
    store = new MemoryPauseStore();
    manager = new PauseManager({ store });
  });

  it('creates pause', async () => {
    const pause = await manager.createPause({
      executionId: 'exec-123',
      mission: 'TestMission',
      duration: '1h',
      checkpoint: {
        stageIndex: 0,
        stepIndex: 0,
        action: 'Test',
        variables: {},
      },
    });

    expect(pause.executionId).toBe('exec-123');
    expect(pause.mission).toBe('TestMission');
    expect(pause.duration).toBe(60 * 60 * 1000);
    expect(pause.resumeTriggers).toContainEqual({ type: 'timeout', active: true });
  });

  it('resumes pause manually', async () => {
    const pause = await manager.createPause({
      executionId: 'exec-123',
      mission: 'TestMission',
      duration: '1h',
      checkpoint: {
        stageIndex: 0,
        stepIndex: 0,
        action: 'Test',
        variables: {},
      },
    });

    const resumed = await manager.resumeManually(pause.id);
    expect(resumed.status).toBe('resumed');
    expect(resumed.resumedBy).toBe('manual');
  });

  it('checks expired pauses', async () => {
    await manager.createPause({
      executionId: 'exec-123',
      mission: 'TestMission',
      duration: -1000, // Already expired
      checkpoint: {
        stageIndex: 0,
        stepIndex: 0,
        action: 'Test',
        variables: {},
      },
    });

    const expired = await manager.checkExpiredPauses();
    expect(expired).toHaveLength(1);
    expect(expired[0].status).toBe('resumed');
    expect(expired[0].resumedBy).toBe('timeout');
  });

  describe('resume is single-shot under races', () => {
    const checkpoint = { stageIndex: 0, stepIndex: 0, action: 'A', variables: {} };

    it('fires onResume once when a timeout poll and a webhook resume race', async () => {
      const onResume = vi.fn();
      const racing = new PauseManager({ store, onResume });
      const pause = await racing.createPause({
        executionId: 'exec-race',
        mission: 'M',
        duration: -1000, // already expired (timeout path is eligible)
        checkpoint,
        resumeTriggers: [{ type: 'webhook', path: '/cb' }],
      });

      await Promise.all([
        racing.checkExpiredPauses(),
        racing.handleWebhook(pause.id, { ok: true }),
      ]);

      expect(onResume).toHaveBeenCalledTimes(1);
      expect((await store.load(pause.id))?.status).toBe('resumed');
    });

    it('is idempotent: a second resume of the same pause does nothing', async () => {
      const onResume = vi.fn();
      const racing = new PauseManager({ store, onResume });
      const pause = await racing.createPause({
        executionId: 'exec-idem',
        mission: 'M',
        duration: '1h',
        checkpoint,
        resumeTriggers: [{ type: 'webhook', path: '/cb' }],
      });

      const first = await racing.handleWebhook(pause.id, {});
      const second = await racing.handleWebhook(pause.id, {});

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('does not overlap itself when a resume callback outlives the poll interval', async () => {
      // Deferred gate created up front so it's always resolvable.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const onResume = vi.fn(() => gate);
      const racing = new PauseManager({ store, onResume });
      await racing.createPause({
        executionId: 'exec-overlap',
        mission: 'M',
        duration: -1000,
        checkpoint,
      });

      const first = racing.checkExpiredPauses(); // enters; resume callback hangs on `gate`
      const second = await racing.checkExpiredPauses(); // overlaps → skipped

      expect(second).toEqual([]);

      release();
      await first;
      expect(onResume).toHaveBeenCalledTimes(1);
    });
  });

  it('cancels pause', async () => {
    const pause = await manager.createPause({
      executionId: 'exec-123',
      mission: 'TestMission',
      duration: '1h',
      checkpoint: {
        stageIndex: 0,
        stepIndex: 0,
        action: 'Test',
        variables: {},
      },
    });

    await manager.cancelPause(pause.id);

    const loaded = await manager.getPause(pause.id);
    expect(loaded!.status).toBe('cancelled');
  });

  it('gets status', async () => {
    await manager.createPause({
      executionId: 'exec-1',
      mission: 'Mission1',
      duration: '1h',
      checkpoint: { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
    });
    await manager.createPause({
      executionId: 'exec-2',
      mission: 'Mission2',
      duration: '2h',
      checkpoint: { stageIndex: 0, stepIndex: 0, action: 'Test', variables: {} },
    });

    const status = await manager.getStatus();
    expect(status.totalActive).toBe(2);
    expect(status.waiting).toBe(2);
    expect(status.pauses).toHaveLength(2);
  });
});
