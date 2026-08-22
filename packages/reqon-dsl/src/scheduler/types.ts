import type { ScheduleDefinition, MissionDefinition } from '../ast/nodes.js';

/**
 * Represents a scheduled job
 */
export interface ScheduledJob {
  id: string;
  missionName: string;
  schedule: ScheduleDefinition;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  failureCount: number;
  consecutiveFailures: number;
  isRunning: boolean;
}

/**
 * Scheduler state persisted to disk
 */
export interface SchedulerState {
  jobs: Record<string, ScheduledJob>;
  startedAt: Date;
  lastUpdated: Date;
}

/**
 * Event emitted when a scheduled job runs
 */
export interface ScheduleEvent {
  type: 'started' | 'completed' | 'failed' | 'skipped';
  jobId: string;
  missionName: string;
  timestamp: Date;
  duration?: number;
  error?: string;
  reason?: string; // For skipped events (e.g., "still running")
}

/**
 * Callbacks for schedule events
 */
export interface SchedulerCallbacks {
  onJobStarted?: (event: ScheduleEvent) => void;
  onJobCompleted?: (event: ScheduleEvent) => void;
  onJobFailed?: (event: ScheduleEvent) => void;
  onJobSkipped?: (event: ScheduleEvent) => void;
}

/**
 * Configuration for the scheduler
 */
export interface SchedulerConfig {
  /** Directory to store scheduler state (default: '.reqon-data/scheduler') */
  stateDir?: string;
  /** Callbacks for schedule events */
  callbacks?: SchedulerCallbacks;
  /** Check interval in milliseconds (default: 1000) */
  checkInterval?: number;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Mission with its parsed program for execution
 */
export interface ScheduledMission {
  mission: MissionDefinition;
  filePath: string;
}
