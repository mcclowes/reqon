import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReqonProgram, MissionDefinition, ScheduleDefinition } from '../ast/nodes.js';
import type { ExecutorConfig, ExecutionResult } from '../interpreter/executor.js';
import { MissionExecutor } from '../interpreter/executor.js';
import type {
  ScheduledJob,
  SchedulerState,
  ScheduleEvent,
  SchedulerCallbacks,
  SchedulerConfig,
  ScheduledMission,
} from './types.js';
import { getNextRunTime, shouldRunNow } from './cron-parser.js';

/**
 * Scheduler for running missions on a schedule
 */
export class Scheduler {
  private config: SchedulerConfig;
  private missions: Map<string, ScheduledMission> = new Map();
  private state: SchedulerState;
  private running = false;
  private checkTimer: NodeJS.Timeout | null = null;
  private retryTimers: Set<NodeJS.Timeout> = new Set();
  private executorConfig: ExecutorConfig;

  constructor(config: SchedulerConfig = {}, executorConfig: ExecutorConfig = {}) {
    this.config = {
      stateDir: config.stateDir ?? '.reqon-data/scheduler',
      checkInterval: config.checkInterval ?? 1000,
      verbose: config.verbose ?? false,
      callbacks: config.callbacks ?? {},
    };

    this.executorConfig = executorConfig;

    this.state = {
      jobs: {},
      startedAt: new Date(),
      lastUpdated: new Date(),
    };
  }

  /**
   * Register a mission for scheduling
   */
  register(mission: MissionDefinition, filePath: string): void {
    if (!mission.schedule) {
      throw new Error(`Mission '${mission.name}' has no schedule defined`);
    }

    this.missions.set(mission.name, { mission, filePath });

    // Create or update job state
    const existingJob = this.state.jobs[mission.name];
    const nextRun = getNextRunTime(mission.schedule);

    this.state.jobs[mission.name] = {
      id: mission.name,
      missionName: mission.name,
      schedule: mission.schedule,
      enabled: true,
      lastRun: existingJob?.lastRun,
      nextRun: nextRun ?? undefined,
      runCount: existingJob?.runCount ?? 0,
      failureCount: existingJob?.failureCount ?? 0,
      consecutiveFailures: existingJob?.consecutiveFailures ?? 0,
      isRunning: false,
    };

    this.log(`Registered mission '${mission.name}' with ${this.formatSchedule(mission.schedule)}`);
  }

  /**
   * Register all scheduled missions from a program
   */
  registerProgram(program: ReqonProgram, filePath: string): void {
    for (const statement of program.statements) {
      if (statement.type === 'MissionDefinition' && statement.schedule) {
        this.register(statement, filePath);
      }
    }
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.running) {
      this.log('Scheduler is already running');
      return;
    }

    this.running = true;
    this.state.startedAt = new Date();

    // Load persisted state
    await this.loadState();

    this.log(`Scheduler started with ${Object.keys(this.state.jobs).length} jobs`);

    // Start the check loop
    this.checkTimer = setInterval(() => {
      this.checkAndRun().catch((error) => {
        this.log(`Scheduler check error: ${error.message}`);
      });
    }, this.config.checkInterval!);

    // Run initial check
    await this.checkAndRun();
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    // Clear all pending retry timers to prevent memory leaks
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    // Save state
    await this.saveState();

    this.log('Scheduler stopped');
  }

  /**
   * Check all jobs and run any that are due
   */
  private async checkAndRun(): Promise<void> {
    const now = new Date();

    for (const [name, job] of Object.entries(this.state.jobs)) {
      if (!job.enabled) continue;

      const scheduledMission = this.missions.get(name);
      if (!scheduledMission) continue;

      const schedule = scheduledMission.mission.schedule;
      if (!schedule) continue; // Mission must have schedule

      // Check if job should run
      if (shouldRunNow(schedule, job.lastRun, this.config.checkInterval)) {
        // Check if already running
        if (job.isRunning && (schedule.skipIfRunning !== false)) {
          this.emitEvent({
            type: 'skipped',
            jobId: job.id,
            missionName: job.missionName,
            timestamp: now,
            reason: 'Previous run still in progress',
          });
          continue;
        }

        // Run the job
        await this.runJob(job, scheduledMission);
      }
    }
  }

  /**
   * Run a scheduled job
   */
  private async runJob(job: ScheduledJob, scheduledMission: ScheduledMission): Promise<void> {
    const startTime = Date.now();

    job.isRunning = true;
    job.lastRun = new Date();
    this.state.lastUpdated = new Date();

    this.emitEvent({
      type: 'started',
      jobId: job.id,
      missionName: job.missionName,
      timestamp: job.lastRun,
    });

    try {
      // Create executor and run mission
      const executor = new MissionExecutor({
        ...this.executorConfig,
        verbose: this.config.verbose,
      });

      // Create a minimal program with just this mission
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [scheduledMission.mission],
      };

      const result = await executor.execute(program);
      const duration = Date.now() - startTime;

      if (result.success) {
        job.runCount++;
        job.consecutiveFailures = 0;

        this.emitEvent({
          type: 'completed',
          jobId: job.id,
          missionName: job.missionName,
          timestamp: new Date(),
          duration,
        });
      } else {
        job.failureCount++;
        job.consecutiveFailures++;

        const errorMessage = result.errors.map((e) => e.message).join('; ');

        this.emitEvent({
          type: 'failed',
          jobId: job.id,
          missionName: job.missionName,
          timestamp: new Date(),
          duration,
          error: errorMessage,
        });

        // Handle retry logic
        await this.handleFailure(job, scheduledMission.mission.schedule!);
      }
    } catch (error) {
      job.failureCount++;
      job.consecutiveFailures++;

      this.emitEvent({
        type: 'failed',
        jobId: job.id,
        missionName: job.missionName,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        error: (error as Error).message,
      });

      // Handle retry logic
      await this.handleFailure(job, scheduledMission.mission.schedule!);
    } finally {
      job.isRunning = false;

      // Calculate next run time
      job.nextRun = getNextRunTime(scheduledMission.mission.schedule!, new Date()) ?? undefined;

      await this.saveState();
    }
  }

  /**
   * Handle job failure with optional retry
   */
  private async handleFailure(job: ScheduledJob, schedule: ScheduleDefinition): Promise<void> {
    const retryConfig = schedule.retryOnFailure;

    if (!retryConfig) return;

    if (job.consecutiveFailures <= retryConfig.maxRetries) {
      this.log(
        `Job '${job.missionName}' failed, retrying in ${retryConfig.delaySeconds}s ` +
          `(attempt ${job.consecutiveFailures}/${retryConfig.maxRetries})`
      );

      // Schedule retry and track the timer to prevent memory leaks
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        const scheduledMission = this.missions.get(job.missionName);
        if (scheduledMission && this.running) {
          this.runJob(job, scheduledMission).catch((error) => {
            this.log(`Retry failed for '${job.missionName}': ${error.message}`);
          });
        }
      }, retryConfig.delaySeconds * 1000);
      this.retryTimers.add(timer);
    } else {
      this.log(
        `Job '${job.missionName}' exceeded max retries (${retryConfig.maxRetries}), waiting for next scheduled run`
      );
    }
  }

  /**
   * Enable a job
   */
  enable(missionName: string): void {
    const job = this.state.jobs[missionName];
    if (job) {
      job.enabled = true;
      this.log(`Enabled job '${missionName}'`);
    }
  }

  /**
   * Disable a job
   */
  disable(missionName: string): void {
    const job = this.state.jobs[missionName];
    if (job) {
      job.enabled = false;
      this.log(`Disabled job '${missionName}'`);
    }
  }

  /**
   * Get job status
   */
  getJob(missionName: string): ScheduledJob | undefined {
    return this.state.jobs[missionName];
  }

  /**
   * Get all jobs
   */
  getJobs(): ScheduledJob[] {
    return Object.values(this.state.jobs);
  }

  /**
   * Trigger a job to run immediately
   */
  async trigger(missionName: string): Promise<ExecutionResult | null> {
    const job = this.state.jobs[missionName];
    const scheduledMission = this.missions.get(missionName);

    if (!job || !scheduledMission) {
      this.log(`Job '${missionName}' not found`);
      return null;
    }

    if (job.isRunning) {
      this.log(`Job '${missionName}' is already running`);
      return null;
    }

    await this.runJob(job, scheduledMission);

    // Return the last execution result (simplified - in practice would need to capture it)
    return null;
  }

  /**
   * Load state from disk
   */
  private async loadState(): Promise<void> {
    try {
      const statePath = join(this.config.stateDir!, 'state.json');
      const content = await readFile(statePath, 'utf-8');
      const savedState = JSON.parse(content) as SchedulerState;

      // Merge saved state with registered jobs
      for (const [name, savedJob] of Object.entries(savedState.jobs)) {
        if (this.state.jobs[name]) {
          this.state.jobs[name].lastRun = savedJob.lastRun ? new Date(savedJob.lastRun) : undefined;
          this.state.jobs[name].runCount = savedJob.runCount;
          this.state.jobs[name].failureCount = savedJob.failureCount;
          this.state.jobs[name].consecutiveFailures = savedJob.consecutiveFailures;
        }
      }

      this.log('Loaded scheduler state from disk');
    } catch {
      // No existing state, that's fine
      this.log('No existing scheduler state found, starting fresh');
    }
  }

  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    try {
      await mkdir(this.config.stateDir!, { recursive: true });
      const statePath = join(this.config.stateDir!, 'state.json');
      await writeFile(statePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      this.log(`Failed to save scheduler state: ${(error as Error).message}`);
    }
  }

  /**
   * Emit a schedule event
   */
  private emitEvent(event: ScheduleEvent): void {
    const { callbacks } = this.config;
    if (!callbacks) return;

    switch (event.type) {
      case 'started':
        callbacks.onJobStarted?.(event);
        break;
      case 'completed':
        callbacks.onJobCompleted?.(event);
        break;
      case 'failed':
        callbacks.onJobFailed?.(event);
        break;
      case 'skipped':
        callbacks.onJobSkipped?.(event);
        break;
    }

    // Always log events in verbose mode
    if (this.config.verbose) {
      const details = event.duration ? ` (${event.duration}ms)` : '';
      const error = event.error ? `: ${event.error}` : '';
      const reason = event.reason ? `: ${event.reason}` : '';
      this.log(`[${event.type.toUpperCase()}] ${event.missionName}${details}${error}${reason}`);
    }
  }

  /**
   * Format schedule for display
   */
  private formatSchedule(schedule: ScheduleDefinition): string {
    switch (schedule.scheduleType) {
      case 'interval':
        return `every ${schedule.interval!.value} ${schedule.interval!.unit}`;
      case 'cron':
        return `cron "${schedule.cronExpression}"`;
      case 'once':
        return `at "${schedule.runAt}"`;
      default:
        return 'unknown schedule';
    }
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Reqon Scheduler] ${message}`);
    }
  }
}
