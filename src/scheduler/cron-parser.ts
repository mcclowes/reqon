import type { ScheduleDefinition, IntervalSchedule } from '../ast/nodes.js';

/**
 * Parse a cron expression and calculate the next run time
 *
 * Cron format: "minute hour day-of-month month day-of-week"
 * Supports: numbers, ranges (1-5), steps (* /5), lists (1,3,5), and wildcards (*)
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
    dayOfWeek: parseField(parts[4], 0, 6, true), // 0 = Sunday; 7 also = Sunday
    // POSIX day matching keys off whether each field is a literal wildcard.
    dayOfMonthRestricted: parts[2] !== '*',
    dayOfWeekRestricted: parts[4] !== '*',
  };
}

interface CronSchedule {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  /** True when day-of-month is not `*` (used for POSIX OR matching). */
  dayOfMonthRestricted: boolean;
  /** True when day-of-week is not `*` (used for POSIX OR matching). */
  dayOfWeekRestricted: boolean;
}

/**
 * Parse one cron field into the explicit set of integers it matches.
 *
 * Validation is strict and fails fast (rather than silently yielding an empty
 * set or, worse, hanging): steps must be integers >= 1, bounds must be numeric,
 * and ranges must not run backwards. When `allowSundaySeven` is set (day-of-week
 * only) a literal 7 is accepted and normalised to 0 (Sunday).
 */
function parseField(field: string, min: number, max: number, allowSundaySeven = false): number[] {
  const values: Set<number> = new Set();

  const toInt = (token: string, label: string): number => {
    const n = parseInt(token, 10);
    if (!Number.isInteger(n) || !/^[+-]?\d+$/.test(token.trim())) {
      throw new Error(`Invalid cron field value '${token}' in '${field}': expected an integer`);
    }
    return n;
  };

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
      if (!Number.isInteger(step) || step < 1) {
        throw new Error(
          `Invalid cron step '${stepStr}' in '${part}': step must be an integer >= 1`
        );
      }

      let start = min;
      let end = max;

      if (range !== '*') {
        if (range.includes('-')) {
          const [rangeStart, rangeEnd] = range.split('-');
          start = toInt(rangeStart, 'range start');
          end = toInt(rangeEnd, 'range end');
        } else {
          start = toInt(range, 'range start');
        }
      }

      if (end < start) {
        throw new Error(`Invalid cron range '${range}' in '${part}': ${start} is after ${end}`);
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part.includes('-')) {
      // Range (e.g., 1-5)
      const [startStr, endStr] = part.split('-');
      const start = toInt(startStr, 'range start');
      const end = toInt(endStr, 'range end');
      if (end < start) {
        throw new Error(`Invalid cron range '${part}': ${start} is after ${end}`);
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      // Single value
      values.add(toInt(part, 'value'));
    }
  }

  // Day-of-week 7 is an alias for Sunday (0) in standard cron.
  const normalized = new Set<number>();
  for (const value of values) {
    normalized.add(allowSundaySeven && value === 7 ? 0 : value);
  }

  // Validate all values are in range (NaN is rejected by `toInt` above, but
  // guard explicitly so an out-of-range NaN can never slip through).
  for (const value of normalized) {
    if (Number.isNaN(value) || value < min || value > max) {
      throw new Error(`Cron field value ${value} out of range [${min}, ${max}]`);
    }
  }

  return Array.from(normalized).sort((a, b) => a - b);
}

/** Wall-clock fields of an instant as observed in a given IANA timezone. */
interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
}

/** Number of days in a given (1-based) month, accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The day-of-week (0 = Sunday) for a calendar date — timezone-independent. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Read the wall-clock fields of an instant in `timeZone`. */
function partsInZone(instant: number, timeZone: string): WallClock {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') map[part.type] = parseInt(part.value, 10);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
  };
}

/** Offset (ms) such that wall-clock-in-zone = instant + offset, at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') m[part.type] = parseInt(part.value, 10);
  }
  const hour = m.hour === 24 ? 0 : m.hour;
  return Date.UTC(m.year, m.month - 1, m.day, hour, m.minute, m.second) - instant;
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
 * Around DST transitions the wall time may be ambiguous or nonexistent; this
 * resolves to a deterministic nearby instant.
 */
function wallToInstant(wc: WallClock, timeZone: string): number {
  const asUTC = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute);
  const offset = zoneOffsetMs(asUTC, timeZone);
  let instant = asUTC - offset;
  const offset2 = zoneOffsetMs(instant, timeZone);
  if (offset2 !== offset) instant = asUTC - offset2;
  return instant;
}

/** Advance a wall-clock by one minute, rolling over fields as needed. */
function addMinute(wc: WallClock): WallClock {
  let { year, month, day, hour, minute } = wc;
  minute += 1;
  if (minute > 59) {
    minute = 0;
    hour += 1;
    if (hour > 23) {
      hour = 0;
      day += 1;
      if (day > daysInMonth(year, month)) {
        day = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }
  }
  return { year, month, day, hour, minute };
}

/**
 * Calculate the next run time for a cron schedule, evaluated against
 * wall-clock time in `timeZone` (default UTC, so DST never shifts the result).
 * Day-of-month and day-of-week follow POSIX: when both are restricted the
 * match is their union (OR), not their intersection.
 */
export function getNextCronRun(
  schedule: CronSchedule,
  after: Date = new Date(),
  timeZone: string = 'UTC'
): Date {
  // Fail fast on combinations that can never match (e.g. Feb 31) instead of
  // grinding through a full multi-year minute-by-minute scan before throwing.
  assertReachableDayMonth(schedule);

  // Start from the first whole minute strictly after `after`.
  const wc = addMinute(partsInZone(after.getTime(), timeZone));

  const maxIterations = 4 * 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (!schedule.month.includes(wc.month)) {
      wc.month += 1;
      if (wc.month > 12) {
        wc.month = 1;
        wc.year += 1;
      }
      wc.day = 1;
      wc.hour = 0;
      wc.minute = 0;
      continue;
    }

    if (wc.day > daysInMonth(wc.year, wc.month)) {
      wc.month += 1;
      if (wc.month > 12) {
        wc.month = 1;
        wc.year += 1;
      }
      wc.day = 1;
      wc.hour = 0;
      wc.minute = 0;
      continue;
    }

    if (!matchesDay(schedule, wc)) {
      wc.day += 1;
      wc.hour = 0;
      wc.minute = 0;
      continue;
    }

    if (!schedule.hour.includes(wc.hour)) {
      wc.hour += 1;
      wc.minute = 0;
      if (wc.hour > 23) {
        wc.hour = 0;
        wc.day += 1;
      }
      continue;
    }

    if (!schedule.minute.includes(wc.minute)) {
      wc.minute += 1;
      if (wc.minute > 59) {
        wc.minute = 0;
        wc.hour += 1;
        if (wc.hour > 23) {
          wc.hour = 0;
          wc.day += 1;
        }
      }
      continue;
    }

    return new Date(wallToInstant(wc, timeZone));
  }

  throw new Error('Could not find next cron run time within 4 years');
}

/** Maximum days any given (1-based) month can have, allowing for leap Februarys. */
const MAX_DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Throw if a restricted day-of-month can never occur in any allowed month.
 * Only applies when day-of-week is a wildcard: with a restricted weekday the
 * POSIX OR means a matching day still occurs every month, so it is reachable.
 */
function assertReachableDayMonth(schedule: CronSchedule): void {
  if (!schedule.dayOfMonthRestricted || schedule.dayOfWeekRestricted) return;

  const reachable = schedule.month.some((m) =>
    schedule.dayOfMonth.some((d) => d <= MAX_DAYS_IN_MONTH[m])
  );
  if (!reachable) {
    throw new Error(
      `Cron schedule can never match: day-of-month [${schedule.dayOfMonth.join(
        ','
      )}] never occurs in month(s) [${schedule.month.join(',')}]`
    );
  }
}

/** POSIX day matching: union of day-of-month and day-of-week when both set. */
function matchesDay(schedule: CronSchedule, wc: WallClock): boolean {
  const domMatch = schedule.dayOfMonth.includes(wc.day);
  const dowMatch = schedule.dayOfWeek.includes(weekdayOf(wc.year, wc.month, wc.day));
  const domR = schedule.dayOfMonthRestricted;
  const dowR = schedule.dayOfWeekRestricted;

  if (domR && dowR) return domMatch || dowMatch;
  if (domR) return domMatch;
  if (dowR) return dowMatch;
  return true;
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
export function getNextRunTime(
  schedule: ScheduleDefinition,
  after: Date = new Date()
): Date | null {
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
      return getNextCronRun(cronSchedule, after, schedule.timezone ?? 'UTC');
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
      // Drift-free: the job is due once its next scheduled time after the last
      // run has arrived. A late or slow poll never silently skips a tick — the
      // overshot run still satisfies `nextRun <= now`, instead of needing `now`
      // to land within a 1s window of the scheduled time.
      const baseline = lastRun ?? new Date(now.getTime() - checkIntervalMs);
      const nextRun = getNextCronRun(cronSchedule, baseline, schedule.timezone ?? 'UTC');
      return nextRun.getTime() <= now.getTime();
    }

    case 'once': {
      if (!schedule.runAt) return false;
      if (lastRun) return false; // Already ran

      // Fire as soon as the scheduled instant has arrived. A missed tick must
      // not strand the job: once runAt is in the past (and it has never run),
      // the next check still catches it, rather than only a ±checkInterval window.
      const runAt = new Date(schedule.runAt);
      return now.getTime() >= runAt.getTime();
    }

    default:
      return false;
  }
}
