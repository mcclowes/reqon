import { describe, it, expect } from 'vitest';
import {
  parseCronExpression,
  getNextCronRun,
  intervalToMs,
  getNextRunTime,
  shouldRunNow,
} from './cron-parser.js';
import type { ScheduleDefinition, IntervalSchedule } from '../ast/nodes.js';

describe('parseCronExpression', () => {
  it('should parse simple cron expressions', () => {
    const schedule = parseCronExpression('0 * * * *');
    expect(schedule.minute).toEqual([0]);
    expect(schedule.hour).toHaveLength(24); // All hours
    expect(schedule.dayOfMonth).toHaveLength(31);
    expect(schedule.month).toHaveLength(12);
    expect(schedule.dayOfWeek).toHaveLength(7);
  });

  it('should parse specific values', () => {
    const schedule = parseCronExpression('30 9 15 6 1');
    expect(schedule.minute).toEqual([30]);
    expect(schedule.hour).toEqual([9]);
    expect(schedule.dayOfMonth).toEqual([15]);
    expect(schedule.month).toEqual([6]);
    expect(schedule.dayOfWeek).toEqual([1]);
  });

  it('should parse ranges', () => {
    const schedule = parseCronExpression('0-5 9-17 * * 1-5');
    expect(schedule.minute).toEqual([0, 1, 2, 3, 4, 5]);
    expect(schedule.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(schedule.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('should parse step values', () => {
    const schedule = parseCronExpression('*/15 */6 * * *');
    expect(schedule.minute).toEqual([0, 15, 30, 45]);
    expect(schedule.hour).toEqual([0, 6, 12, 18]);
  });

  it('should parse lists', () => {
    const schedule = parseCronExpression('0,30 9,12,18 * * *');
    expect(schedule.minute).toEqual([0, 30]);
    expect(schedule.hour).toEqual([9, 12, 18]);
  });

  it('should parse combined expressions', () => {
    const schedule = parseCronExpression('0 9-17/2 * * 1-5');
    expect(schedule.minute).toEqual([0]);
    expect(schedule.hour).toEqual([9, 11, 13, 15, 17]);
    expect(schedule.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('should throw on invalid cron expression', () => {
    expect(() => parseCronExpression('0 * *')).toThrow('expected 5 fields');
  });

  it('should throw on out of range values', () => {
    expect(() => parseCronExpression('60 * * * *')).toThrow('out of range');
    expect(() => parseCronExpression('* 25 * * *')).toThrow('out of range');
  });
});

describe('getNextCronRun', () => {
  it('should calculate next run for every minute', () => {
    const schedule = parseCronExpression('* * * * *');
    const now = new Date('2025-01-20T10:30:00Z');
    const next = getNextCronRun(schedule, now);

    expect(next.getMinutes()).toBe(31);
    expect(next.getHours()).toBe(10);
  });

  it('should calculate next run for specific time', () => {
    const schedule = parseCronExpression('0 9 * * *');
    const now = new Date('2025-01-20T10:30:00Z');
    const next = getNextCronRun(schedule, now);

    // Should be 9:00 the next day
    expect(next.getMinutes()).toBe(0);
    expect(next.getHours()).toBe(9);
    expect(next.getDate()).toBe(21);
  });

  it('should handle hourly schedules', () => {
    const schedule = parseCronExpression('0 * * * *');
    const now = new Date('2025-01-20T10:30:00Z');
    const next = getNextCronRun(schedule, now);

    expect(next.getMinutes()).toBe(0);
    expect(next.getHours()).toBe(11);
  });

  it('should handle day of week constraints', () => {
    const schedule = parseCronExpression('0 9 * * 1'); // Monday only
    const now = new Date('2025-01-20T10:30:00Z'); // This is a Monday
    const next = getNextCronRun(schedule, now);

    // Should be next Monday at 9:00
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });
});

describe('intervalToMs', () => {
  it('should convert seconds to ms', () => {
    const interval: IntervalSchedule = { value: 30, unit: 'seconds' };
    expect(intervalToMs(interval)).toBe(30_000);
  });

  it('should convert minutes to ms', () => {
    const interval: IntervalSchedule = { value: 5, unit: 'minutes' };
    expect(intervalToMs(interval)).toBe(5 * 60 * 1000);
  });

  it('should convert hours to ms', () => {
    const interval: IntervalSchedule = { value: 6, unit: 'hours' };
    expect(intervalToMs(interval)).toBe(6 * 60 * 60 * 1000);
  });

  it('should convert days to ms', () => {
    const interval: IntervalSchedule = { value: 1, unit: 'days' };
    expect(intervalToMs(interval)).toBe(24 * 60 * 60 * 1000);
  });

  it('should convert weeks to ms', () => {
    const interval: IntervalSchedule = { value: 1, unit: 'weeks' };
    expect(intervalToMs(interval)).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('getNextRunTime', () => {
  it('should calculate next run for interval schedule', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'interval',
      interval: { value: 6, unit: 'hours' },
    };

    const now = new Date('2025-01-20T10:00:00Z');
    const next = getNextRunTime(schedule, now);

    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(now.getTime() + 6 * 60 * 60 * 1000);
  });

  it('should calculate next run for cron schedule', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'cron',
      cronExpression: '0 */6 * * *',
    };

    const now = new Date('2025-01-20T10:30:00Z');
    const next = getNextRunTime(schedule, now);

    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getHours()).toBe(12); // Next 6-hour mark
  });

  it('should calculate next run for one-time schedule', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'once',
      runAt: '2025-01-25T15:00:00Z',
    };

    const now = new Date('2025-01-20T10:00:00Z');
    const next = getNextRunTime(schedule, now);

    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2025-01-25T15:00:00.000Z');
  });

  it('should return null for past one-time schedule', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'once',
      runAt: '2025-01-15T15:00:00Z',
    };

    const now = new Date('2025-01-20T10:00:00Z');
    const next = getNextRunTime(schedule, now);

    expect(next).toBeNull();
  });
});

describe('shouldRunNow', () => {
  it('should return true for interval schedule that is due', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'interval',
      interval: { value: 1, unit: 'hours' },
    };

    const lastRun = new Date(Date.now() - 61 * 60 * 1000); // 61 minutes ago
    expect(shouldRunNow(schedule, lastRun)).toBe(true);
  });

  it('should return false for interval schedule not yet due', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'interval',
      interval: { value: 1, unit: 'hours' },
    };

    const lastRun = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    expect(shouldRunNow(schedule, lastRun)).toBe(false);
  });

  it('should return true for first run of interval schedule', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'interval',
      interval: { value: 1, unit: 'hours' },
    };

    expect(shouldRunNow(schedule, undefined)).toBe(true);
  });

  it('should return false for one-time schedule that already ran', () => {
    const schedule: ScheduleDefinition = {
      type: 'ScheduleDefinition',
      scheduleType: 'once',
      runAt: '2025-01-15T15:00:00Z',
    };

    const lastRun = new Date('2025-01-15T15:00:00Z');
    expect(shouldRunNow(schedule, lastRun)).toBe(false);
  });
});
