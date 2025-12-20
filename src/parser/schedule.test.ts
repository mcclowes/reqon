import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition, ScheduleDefinition } from '../ast/nodes.js';

function parseSchedule(source: string): ScheduleDefinition | undefined {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens);
  const program = parser.parse();
  const mission = program.statements.find((s) => s.type === 'MissionDefinition') as
    | MissionDefinition
    | undefined;
  return mission?.schedule;
}

describe('Schedule parsing', () => {
  describe('interval schedules', () => {
    it('should parse schedule: every N hours', () => {
      const source = `
        mission Test {
          schedule: every 6 hours
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('interval');
      expect(schedule!.interval).toEqual({ value: 6, unit: 'hours' });
    });

    it('should parse schedule: every N minutes', () => {
      const source = `
        mission Test {
          schedule: every 30 minutes
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('interval');
      expect(schedule!.interval).toEqual({ value: 30, unit: 'minutes' });
    });

    it('should parse schedule: every N seconds', () => {
      const source = `
        mission Test {
          schedule: every 60 seconds
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('interval');
      expect(schedule!.interval).toEqual({ value: 60, unit: 'seconds' });
    });

    it('should parse schedule: every N days', () => {
      const source = `
        mission Test {
          schedule: every 1 days
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('interval');
      expect(schedule!.interval).toEqual({ value: 1, unit: 'days' });
    });

    it('should parse schedule: every N weeks', () => {
      const source = `
        mission Test {
          schedule: every 2 weeks
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('interval');
      expect(schedule!.interval).toEqual({ value: 2, unit: 'weeks' });
    });
  });

  describe('cron schedules', () => {
    it('should parse schedule: cron expression', () => {
      const source = `
        mission Test {
          schedule: cron "0 */6 * * *"
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('cron');
      expect(schedule!.cronExpression).toBe('0 */6 * * *');
    });

    it('should parse complex cron expressions', () => {
      const source = `
        mission Test {
          schedule: cron "30 9 15 * 1-5"
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('cron');
      expect(schedule!.cronExpression).toBe('30 9 15 * 1-5');
    });
  });

  describe('one-time schedules', () => {
    it('should parse schedule: at datetime', () => {
      const source = `
        mission Test {
          schedule: at "2025-01-25T15:00:00Z"
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('once');
      expect(schedule!.runAt).toBe('2025-01-25T15:00:00Z');
    });
  });

  describe('schedule options', () => {
    it('should parse schedule with timezone option', () => {
      const source = `
        mission Test {
          schedule: every 6 hours {
            timezone: "America/New_York"
          }
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.timezone).toBe('America/New_York');
    });

    it('should parse schedule with maxConcurrency option', () => {
      const source = `
        mission Test {
          schedule: every 6 hours {
            maxConcurrency: 2
          }
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.maxConcurrency).toBe(2);
    });

    it('should parse schedule with skipIfRunning option', () => {
      const source = `
        mission Test {
          schedule: every 6 hours {
            skipIfRunning: false
          }
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.skipIfRunning).toBe(false);
    });

    it('should parse schedule with retry config', () => {
      const source = `
        mission Test {
          schedule: every 6 hours {
            retry: {
              maxRetries: 5,
              delaySeconds: 120
            }
          }
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.retryOnFailure).toEqual({
        maxRetries: 5,
        delaySeconds: 120,
      });
    });

    it('should parse schedule with multiple options', () => {
      const source = `
        mission Test {
          schedule: cron "0 9 * * 1-5" {
            timezone: "Europe/London",
            maxConcurrency: 1,
            skipIfRunning: true,
            retry: {
              maxRetries: 3,
              delaySeconds: 60
            }
          }
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeDefined();
      expect(schedule!.scheduleType).toBe('cron');
      expect(schedule!.cronExpression).toBe('0 9 * * 1-5');
      expect(schedule!.timezone).toBe('Europe/London');
      expect(schedule!.maxConcurrency).toBe(1);
      expect(schedule!.skipIfRunning).toBe(true);
      expect(schedule!.retryOnFailure).toEqual({
        maxRetries: 3,
        delaySeconds: 60,
      });
    });
  });

  describe('mission without schedule', () => {
    it('should parse mission without schedule', () => {
      const source = `
        mission Test {
          source API { auth: none, base: "http://api.example.com" }
          action Sync { fetch GET "/data" }
          run Sync
        }
      `;

      const schedule = parseSchedule(source);

      expect(schedule).toBeUndefined();
    });
  });
});
