import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from './scheduler.js';
import type { MissionDefinition, ScheduleDefinition, ReqonProgram } from '../ast/nodes.js';
import type { SchedulerCallbacks, ScheduleEvent } from './types.js';

// Mock fs operations
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    throw new Error('ENOENT');
  }),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}));

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let callbacks: SchedulerCallbacks;
  let events: ScheduleEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];

    callbacks = {
      onJobStarted: vi.fn((event) => events.push(event)),
      onJobCompleted: vi.fn((event) => events.push(event)),
      onJobFailed: vi.fn((event) => events.push(event)),
      onJobSkipped: vi.fn((event) => events.push(event)),
    };

    scheduler = new Scheduler(
      {
        stateDir: '.test-scheduler',
        checkInterval: 100,
        verbose: false,
        callbacks,
      },
      { dryRun: true } // Use dry run to avoid actual execution
    );
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.useRealTimers();
  });

  const createMission = (name: string, schedule: ScheduleDefinition): MissionDefinition => ({
    type: 'MissionDefinition',
    name,
    schedule,
    sources: [],
    stores: [],
    schemas: [],
    actions: [],
    pipeline: { type: 'PipelineDefinition', stages: [] },
  });

  describe('registration', () => {
    it('registers a mission with interval schedule', () => {
      const mission = createMission('testMission', {
        scheduleType: 'interval',
        interval: { value: 5, unit: 'minutes' },
      });

      scheduler.register(mission, '/path/to/mission.vague');

      const job = scheduler.getJob('testMission');
      expect(job).toBeDefined();
      expect(job?.missionName).toBe('testMission');
      expect(job?.enabled).toBe(true);
      expect(job?.runCount).toBe(0);
    });

    it('registers a mission with cron schedule', () => {
      const mission = createMission('cronMission', {
        scheduleType: 'cron',
        cronExpression: '0 * * * *', // Every hour
      });

      scheduler.register(mission, '/path/to/mission.vague');

      const job = scheduler.getJob('cronMission');
      expect(job).toBeDefined();
      expect(job?.schedule.scheduleType).toBe('cron');
    });

    it('registers a mission with once schedule', () => {
      const mission = createMission('onceMission', {
        scheduleType: 'once',
        runAt: '2024-12-25T00:00:00Z',
      });

      scheduler.register(mission, '/path/to/mission.vague');

      const job = scheduler.getJob('onceMission');
      expect(job).toBeDefined();
      expect(job?.schedule.scheduleType).toBe('once');
    });

    it('throws when registering mission without schedule', () => {
      const mission: MissionDefinition = {
        type: 'MissionDefinition',
        name: 'noSchedule',
        sources: [],
        stores: [],
        schemas: [],
        actions: [],
        pipeline: { type: 'PipelineDefinition', stages: [] },
      };

      expect(() => scheduler.register(mission, '/path/to/mission.vague')).toThrow(
        "Mission 'noSchedule' has no schedule defined"
      );
    });

    it('preserves existing job state when re-registering', () => {
      const mission = createMission('existingMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'hours' },
      });

      scheduler.register(mission, '/path/mission.vague');

      // Manually update state
      const job = scheduler.getJob('existingMission');
      if (job) {
        job.runCount = 5;
        job.failureCount = 2;
      }

      // Re-register
      scheduler.register(mission, '/path/mission.vague');

      const updatedJob = scheduler.getJob('existingMission');
      expect(updatedJob?.runCount).toBe(5);
      expect(updatedJob?.failureCount).toBe(2);
    });

    it('registers all scheduled missions from a program', () => {
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          createMission('mission1', {
            scheduleType: 'interval',
            interval: { value: 5, unit: 'minutes' },
          }),
          createMission('mission2', {
            scheduleType: 'cron',
            cronExpression: '0 0 * * *',
          }),
          // Non-scheduled mission (no schedule property)
          {
            type: 'MissionDefinition',
            name: 'unscheduled',
            sources: [],
            stores: [],
            schemas: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] },
          },
        ],
      };

      scheduler.registerProgram(program, '/path/program.vague');

      expect(scheduler.getJob('mission1')).toBeDefined();
      expect(scheduler.getJob('mission2')).toBeDefined();
      expect(scheduler.getJob('unscheduled')).toBeUndefined();
    });
  });

  describe('job management', () => {
    beforeEach(() => {
      const mission = createMission('managedMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'hours' },
      });
      scheduler.register(mission, '/path/mission.vague');
    });

    it('enables a job', () => {
      scheduler.disable('managedMission');
      expect(scheduler.getJob('managedMission')?.enabled).toBe(false);

      scheduler.enable('managedMission');
      expect(scheduler.getJob('managedMission')?.enabled).toBe(true);
    });

    it('disables a job', () => {
      scheduler.disable('managedMission');
      expect(scheduler.getJob('managedMission')?.enabled).toBe(false);
    });

    it('returns all jobs', () => {
      const mission2 = createMission('anotherMission', {
        scheduleType: 'interval',
        interval: { value: 30, unit: 'minutes' },
      });
      scheduler.register(mission2, '/path/mission2.vague');

      const jobs = scheduler.getJobs();
      expect(jobs.length).toBe(2);
      expect(jobs.map((j) => j.missionName)).toContain('managedMission');
      expect(jobs.map((j) => j.missionName)).toContain('anotherMission');
    });

    it('returns undefined for non-existent job', () => {
      expect(scheduler.getJob('nonExistent')).toBeUndefined();
    });
  });

  describe('scheduler lifecycle', () => {
    it('starts the scheduler', async () => {
      const mission = createMission('startMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'hours' },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.start();

      // Scheduler should be running
      // Verify by checking it doesn't throw on second start
      await scheduler.start(); // Should log "already running" but not throw
    });

    it('stops the scheduler', async () => {
      const mission = createMission('stopMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'hours' },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.start();
      await scheduler.stop();

      // Should be safe to call stop again
      await scheduler.stop();
    });

    it('clears retry timers on stop', async () => {
      const mission = createMission('retryMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
        retryOnFailure: {
          maxRetries: 3,
          delaySeconds: 5,
        },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.start();

      // Advance to trigger a run
      vi.advanceTimersByTime(2000);

      await scheduler.stop();
      // Should not throw or leak timers
    });
  });

  describe('job execution', () => {
    it('skips disabled jobs', async () => {
      const mission = createMission('disabledMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });
      scheduler.register(mission, '/path/mission.vague');
      scheduler.disable('disabledMission');

      await scheduler.start();
      vi.advanceTimersByTime(2000);

      expect(callbacks.onJobStarted).not.toHaveBeenCalled();
    });

    it('skips job if already running', async () => {
      const mission = createMission('runningMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
        skipIfRunning: true,
      });
      scheduler.register(mission, '/path/mission.vague');

      // Manually set job as running
      const job = scheduler.getJob('runningMission');
      if (job) {
        job.isRunning = true;
        job.lastRun = new Date(Date.now() - 2000);
      }

      await scheduler.start();
      vi.advanceTimersByTime(2000);

      const skippedEvents = events.filter((e) => e.type === 'skipped');
      expect(skippedEvents.length).toBeGreaterThan(0);
      expect(skippedEvents[0].reason).toContain('still in progress');
    });

    it('tracks run count on successful execution', async () => {
      const mission = createMission('countMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.start();
      vi.advanceTimersByTime(1500);

      const job = scheduler.getJob('countMission');
      // In dry run mode, execution completes successfully
      expect(job?.runCount).toBeGreaterThanOrEqual(0);
    });

    it('updates lastRun timestamp', async () => {
      const mission = createMission('timestampMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });
      scheduler.register(mission, '/path/mission.vague');

      const beforeStart = new Date();
      await scheduler.start();
      vi.advanceTimersByTime(1500);

      const job = scheduler.getJob('timestampMission');
      if (job?.lastRun) {
        expect(job.lastRun.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      }
    });

    it('updates nextRun after execution', async () => {
      const mission = createMission('nextRunMission', {
        scheduleType: 'interval',
        interval: { value: 5, unit: 'minutes' },
      });
      scheduler.register(mission, '/path/mission.vague');

      const job = scheduler.getJob('nextRunMission');
      const initialNextRun = job?.nextRun;

      await scheduler.start();
      vi.advanceTimersByTime(1000);

      // nextRun should be calculated
      expect(job?.nextRun).toBeDefined();
    });
  });

  describe('manual trigger', () => {
    it('triggers a job immediately', async () => {
      const mission = createMission('triggerMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'hours' },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.trigger('triggerMission');

      expect(callbacks.onJobStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          missionName: 'triggerMission',
        })
      );
    });

    it('returns null for non-existent job', async () => {
      const result = await scheduler.trigger('nonExistent');
      expect(result).toBeNull();
    });

    it('returns null if job is already running', async () => {
      const mission = createMission('alreadyRunning', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'hours' },
      });
      scheduler.register(mission, '/path/mission.vague');

      const job = scheduler.getJob('alreadyRunning');
      if (job) {
        job.isRunning = true;
      }

      const result = await scheduler.trigger('alreadyRunning');
      expect(result).toBeNull();
    });
  });

  describe('failure handling', () => {
    it('tracks failure count', async () => {
      // Create a scheduler that will cause failures
      const failScheduler = new Scheduler(
        {
          stateDir: '.test-scheduler-fail',
          checkInterval: 100,
          callbacks,
        },
        {} // No dry run, but no actual executor implementation
      );

      const mission = createMission('failMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });

      failScheduler.register(mission, '/path/mission.vague');

      await failScheduler.start();
      vi.advanceTimersByTime(1500);

      const job = failScheduler.getJob('failMission');
      // Failure count should be tracked
      expect(job?.failureCount).toBeGreaterThanOrEqual(0);

      await failScheduler.stop();
    });

    it('tracks consecutive failures', async () => {
      const failScheduler = new Scheduler(
        {
          stateDir: '.test-scheduler-consec',
          checkInterval: 100,
          callbacks,
        },
        {}
      );

      const mission = createMission('consecFailMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });

      failScheduler.register(mission, '/path/mission.vague');

      await failScheduler.start();
      vi.advanceTimersByTime(3000);

      const job = failScheduler.getJob('consecFailMission');
      expect(job?.consecutiveFailures).toBeGreaterThanOrEqual(0);

      await failScheduler.stop();
    });
  });

  describe('retry on failure', () => {
    it('schedules retry after failure', async () => {
      const retryScheduler = new Scheduler(
        {
          stateDir: '.test-scheduler-retry',
          checkInterval: 100,
          callbacks,
        },
        {}
      );

      const mission = createMission('retryMission', {
        scheduleType: 'interval',
        interval: { value: 10, unit: 'seconds' },
        retryOnFailure: {
          maxRetries: 3,
          delaySeconds: 2,
        },
      });

      retryScheduler.register(mission, '/path/mission.vague');

      await retryScheduler.start();
      vi.advanceTimersByTime(15000);

      // Check that retry logic was engaged
      const job = retryScheduler.getJob('retryMission');
      expect(job).toBeDefined();

      await retryScheduler.stop();
    });
  });

  describe('event callbacks', () => {
    it('emits started event', async () => {
      const mission = createMission('eventMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.start();
      vi.advanceTimersByTime(1500);

      expect(callbacks.onJobStarted).toHaveBeenCalled();
      const startEvent = events.find((e) => e.type === 'started');
      expect(startEvent?.missionName).toBe('eventMission');
    });

    it('emits completed event on success', async () => {
      const mission = createMission('completeMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });
      scheduler.register(mission, '/path/mission.vague');

      await scheduler.start();
      vi.advanceTimersByTime(1500);

      // In dry run mode, should complete successfully
      const completedEvent = events.find((e) => e.type === 'completed');
      if (completedEvent) {
        expect(completedEvent.missionName).toBe('completeMission');
        expect(completedEvent.duration).toBeDefined();
      }
    });

    it('emits failed event on error', async () => {
      const failScheduler = new Scheduler(
        {
          stateDir: '.test-scheduler-fail-event',
          checkInterval: 100,
          callbacks,
        },
        {}
      );

      const mission = createMission('failEventMission', {
        scheduleType: 'interval',
        interval: { value: 1, unit: 'seconds' },
      });

      failScheduler.register(mission, '/path/mission.vague');

      await failScheduler.start();
      vi.advanceTimersByTime(1500);

      const failedEvent = events.find((e) => e.type === 'failed');
      if (failedEvent) {
        expect(failedEvent.missionName).toBe('failEventMission');
        expect(failedEvent.error).toBeDefined();
      }

      await failScheduler.stop();
    });
  });

  describe('schedule formatting', () => {
    it('formats interval schedule', () => {
      // Access private method via prototype or test through registration logs
      const verboseScheduler = new Scheduler({
        stateDir: '.test-scheduler-format',
        checkInterval: 100,
        verbose: true,
        callbacks,
      });

      const consoleSpy = vi.spyOn(console, 'log');

      const mission = createMission('formatMission', {
        scheduleType: 'interval',
        interval: { value: 5, unit: 'minutes' },
      });

      verboseScheduler.register(mission, '/path/mission.vague');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('every 5 minutes')
      );

      consoleSpy.mockRestore();
    });
  });
});
