import type { ScheduleDefinition, IntervalSchedule } from '../ast/nodes.js';

/**
 * Parse a cron expression and calculate the next run time
 *
 * Cron format: "minute hour day-of-month month day-of-week"
 * Supports: numbers, ranges (1-5), steps (*​/5), lists (1,3,5), and wildcards (*)
 */
export function parseCronExpression(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0 = Sunday
  };
}

interface CronSchedule {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      // All values
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else if (part.includes('/')) {
      // Step values (e.g., */5 or 1-10/2)
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);

      let start = min;
      let end = max;

      if (range !== '*') {
        if (range.includes('-')) {
          const [rangeStart, rangeEnd] = range.split('-').map((n) => parseInt(n, 10));
          start = rangeStart;
          end = rangeEnd;
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part.includes('-')) {
      // Range (e.g., 1-5)
      const [start, end] = part.split('-').map((n) => parseInt(n, 10));
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      // Single value
      values.add(parseInt(part, 10));
    }
  }

  // Validate all values are in range
  for (const value of values) {
    if (value < min || value > max) {
      throw new Error(`Cron field value ${value} out of range [${min}, ${max}]`);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Calculate the next run time for a cron schedule
 */
export function getNextCronRun(schedule: CronSchedule, after: Date = new Date()): Date {
  const next = new Date(after);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1); // Start from next minute

  // Try up to 4 years to find a match
  const maxIterations = 4 * 366 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    // Check month
    if (!schedule.month.includes(next.getMonth() + 1)) {
      // Move to first day of next matching month
      next.setMonth(next.getMonth() + 1);
      next.setDate(1);
      next.setHours(0, 0, 0, 0);
      continue;
    }

    // Check day of month
    if (!schedule.dayOfMonth.includes(next.getDate())) {
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      continue;
    }

    // Check day of week
    if (!schedule.dayOfWeek.includes(next.getDay())) {
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      continue;
    }

    // Check hour
    if (!schedule.hour.includes(next.getHours())) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
      continue;
    }

    // Check minute
    if (!schedule.minute.includes(next.getMinutes())) {
      next.setMinutes(next.getMinutes() + 1);
      continue;
    }

    // Found a match!
    return next;
  }

  throw new Error('Could not find next cron run time within 4 years');
}

/**
 * Convert interval schedule to milliseconds
 */
export function intervalToMs(interval: IntervalSchedule): number {
  const multipliers: Record<IntervalSchedule['unit'], number> = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  };

  return interval.value * multipliers[interval.unit];
}

/**
 * Calculate next run time based on schedule definition
 */
export function getNextRunTime(schedule: ScheduleDefinition, after: Date = new Date()): Date | null {
  switch (schedule.scheduleType) {
    case 'interval': {
      if (!schedule.interval) {
        throw new Error('Interval schedule missing interval configuration');
      }
      const intervalMs = intervalToMs(schedule.interval);
      return new Date(after.getTime() + intervalMs);
    }

    case 'cron': {
      if (!schedule.cronExpression) {
        throw new Error('Cron schedule missing cron expression');
      }
      const cronSchedule = parseCronExpression(schedule.cronExpression);
      return getNextCronRun(cronSchedule, after);
    }

    case 'once': {
      if (!schedule.runAt) {
        throw new Error('One-time schedule missing runAt datetime');
      }
      const runAt = new Date(schedule.runAt);
      // If the scheduled time is in the past, return null (job should not run)
      if (runAt <= after) {
        return null;
      }
      return runAt;
    }

    default:
      throw new Error(`Unknown schedule type: ${schedule.scheduleType}`);
  }
}

/**
 * Check if a schedule should run now (within the check interval)
 */
export function shouldRunNow(
  schedule: ScheduleDefinition,
  lastRun: Date | undefined,
  checkIntervalMs: number = 1000
): boolean {
  const now = new Date();

  switch (schedule.scheduleType) {
    case 'interval': {
      if (!lastRun) return true; // Never run before, run now
      if (!schedule.interval) return false;

      const intervalMs = intervalToMs(schedule.interval);
      const elapsed = now.getTime() - lastRun.getTime();
      return elapsed >= intervalMs;
    }

    case 'cron': {
      if (!schedule.cronExpression) return false;

      const cronSchedule = parseCronExpression(schedule.cronExpression);
      const nextRun = getNextCronRun(cronSchedule, lastRun ?? new Date(0));

      // Check if we're within the check interval of the next run time
      const diff = Math.abs(now.getTime() - nextRun.getTime());
      return diff <= checkIntervalMs;
    }

    case 'once': {
      if (!schedule.runAt) return false;
      if (lastRun) return false; // Already ran

      const runAt = new Date(schedule.runAt);
      const diff = Math.abs(now.getTime() - runAt.getTime());
      return diff <= checkIntervalMs;
    }

    default:
      return false;
  }
}
