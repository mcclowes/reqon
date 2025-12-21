/**
 * Schedule definition parsing
 * Handles parsing of schedule definitions (interval, cron, and one-time schedules).
 */
import { TokenType } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type { ScheduleDefinition, IntervalSchedule, ScheduleRetryConfig } from '../ast/nodes.js';
import { SourceParser } from './source-parser.js';

export class ScheduleParser extends SourceParser {
  parseSchedule(): ScheduleDefinition {
    this.consume(ReqonTokenType.SCHEDULE, "Expected 'schedule'");
    this.consume(TokenType.COLON, "Expected ':'");

    let scheduleType: ScheduleDefinition['scheduleType'];
    let interval: IntervalSchedule | undefined;
    let cronExpression: string | undefined;
    let runAt: string | undefined;
    let timezone: string | undefined;
    let maxConcurrency: number | undefined;
    let skipIfRunning: boolean | undefined;
    let retryOnFailure: ScheduleRetryConfig | undefined;

    // Determine schedule type
    if (this.check(ReqonTokenType.EVERY)) {
      // Interval-based: schedule: every 6 hours
      scheduleType = 'interval';
      interval = this.parseIntervalSchedule();
    } else if (this.check(ReqonTokenType.CRON)) {
      // Cron-based: schedule: cron "0 */6 * * *"
      scheduleType = 'cron';
      this.advance(); // consume 'cron'
      cronExpression = this.consume(TokenType.STRING, 'Expected cron expression string').value;
    } else if (this.check(ReqonTokenType.AT)) {
      // One-time: schedule: at "2025-01-20 09:00 UTC"
      scheduleType = 'once';
      this.advance(); // consume 'at'
      runAt = this.consume(TokenType.STRING, 'Expected datetime string').value;
    } else {
      throw this.error(`Expected 'every', 'cron', or 'at' for schedule type`);
    }

    // Optional configuration block
    if (this.match(TokenType.LBRACE)) {
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        // Handle keyword tokens that can appear as option keys
        let key: string;
        if (this.check(ReqonTokenType.RETRY)) {
          this.advance();
          key = 'retry';
        } else {
          key = this.consume(TokenType.IDENTIFIER, 'Expected schedule option key').value;
        }
        this.consume(TokenType.COLON, "Expected ':'");

        switch (key) {
          case 'timezone':
            timezone = this.consume(TokenType.STRING, 'Expected timezone string').value;
            break;
          case 'maxConcurrency':
            maxConcurrency = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
            break;
          case 'skipIfRunning':
            skipIfRunning = this.match(TokenType.TRUE);
            if (!skipIfRunning) {
              this.consume(TokenType.FALSE, "Expected 'true' or 'false'");
            }
            break;
          case 'retry':
            retryOnFailure = this.parseScheduleRetryConfig();
            break;
          default:
            throw this.error(`Unknown schedule option: ${key}`);
        }

        this.match(TokenType.COMMA);
      }
      this.consume(TokenType.RBRACE, "Expected '}'");
    }

    return {
      type: 'ScheduleDefinition',
      scheduleType,
      interval,
      cronExpression,
      runAt,
      timezone,
      maxConcurrency,
      skipIfRunning,
      retryOnFailure,
    };
  }

  protected parseIntervalSchedule(): IntervalSchedule {
    this.consume(ReqonTokenType.EVERY, "Expected 'every'");
    const value = parseInt(this.consume(TokenType.NUMBER, 'Expected interval value').value, 10);

    let unit: IntervalSchedule['unit'];
    const unitToken = this.advance();

    switch (unitToken.type) {
      case ReqonTokenType.SECONDS:
        unit = 'seconds';
        break;
      case ReqonTokenType.MINUTES:
        unit = 'minutes';
        break;
      case ReqonTokenType.HOURS:
        unit = 'hours';
        break;
      case ReqonTokenType.DAYS:
        unit = 'days';
        break;
      case ReqonTokenType.WEEKS:
        unit = 'weeks';
        break;
      default:
        throw this.error(`Expected time unit (seconds, minutes, hours, days, weeks), got: ${unitToken.value}`);
    }

    return { value, unit };
  }

  protected parseScheduleRetryConfig(): ScheduleRetryConfig {
    this.consume(TokenType.LBRACE, "Expected '{'");

    let maxRetries = 3;
    let delaySeconds = 60;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.consume(TokenType.IDENTIFIER, 'Expected retry option').value;
      this.consume(TokenType.COLON, "Expected ':'");

      switch (key) {
        case 'maxRetries':
          maxRetries = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        case 'delaySeconds':
          delaySeconds = parseInt(this.consume(TokenType.NUMBER, 'Expected number').value, 10);
          break;
        default:
          throw this.error(`Unknown retry option: ${key}`);
      }

      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return { maxRetries, delaySeconds };
  }
}
