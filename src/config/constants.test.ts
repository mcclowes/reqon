/**
 * Tests for centralized configuration constants
 */
import { describe, it, expect } from 'vitest';
import {
  HTTP_RETRY_DEFAULTS,
  RATE_LIMIT_DEFAULTS,
  CIRCUIT_BREAKER_DEFAULTS,
  WEBHOOK_DEFAULTS,
  STORE_DEFAULTS,
  SCHEDULER_DEFAULTS,
  EXECUTION_DEFAULTS,
} from './constants.js';

describe('Configuration Constants', () => {
  describe('HTTP_RETRY_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(HTTP_RETRY_DEFAULTS.MAX_ATTEMPTS).toBe(3);
      expect(HTTP_RETRY_DEFAULTS.INITIAL_DELAY_MS).toBe(1000);
      expect(HTTP_RETRY_DEFAULTS.MAX_DELAY_MS).toBe(30000);
      expect(HTTP_RETRY_DEFAULTS.BACKOFF).toBe('exponential');
    });

    it('values are positive numbers', () => {
      expect(HTTP_RETRY_DEFAULTS.MAX_ATTEMPTS).toBeGreaterThan(0);
      expect(HTTP_RETRY_DEFAULTS.INITIAL_DELAY_MS).toBeGreaterThan(0);
      expect(HTTP_RETRY_DEFAULTS.MAX_DELAY_MS).toBeGreaterThan(0);
    });

    it('max delay is greater than initial delay', () => {
      expect(HTTP_RETRY_DEFAULTS.MAX_DELAY_MS).toBeGreaterThan(
        HTTP_RETRY_DEFAULTS.INITIAL_DELAY_MS
      );
    });
  });

  describe('RATE_LIMIT_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(RATE_LIMIT_DEFAULTS.STRATEGY).toBe('pause');
      expect(RATE_LIMIT_DEFAULTS.MAX_WAIT_SECONDS).toBe(300);
      expect(RATE_LIMIT_DEFAULTS.NOTIFY_AT_SECONDS).toBe(10);
      expect(RATE_LIMIT_DEFAULTS.FALLBACK_RPM).toBe(60);
    });

    it('cleanup intervals are positive', () => {
      expect(RATE_LIMIT_DEFAULTS.MAX_STALE_AGE_MS).toBeGreaterThan(0);
      expect(RATE_LIMIT_DEFAULTS.CLEANUP_INTERVAL_MS).toBeGreaterThan(0);
      expect(RATE_LIMIT_DEFAULTS.CLEANUP_CHECK_INTERVAL).toBeGreaterThan(0);
      expect(RATE_LIMIT_DEFAULTS.MAX_ENTRIES_BEFORE_CLEANUP).toBeGreaterThan(0);
    });

    it('strategy is a valid option', () => {
      expect(['pause', 'throttle', 'fail']).toContain(RATE_LIMIT_DEFAULTS.STRATEGY);
    });
  });

  describe('CIRCUIT_BREAKER_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(CIRCUIT_BREAKER_DEFAULTS.FAILURE_THRESHOLD).toBe(5);
      expect(CIRCUIT_BREAKER_DEFAULTS.RESET_TIMEOUT_MS).toBe(30000);
      expect(CIRCUIT_BREAKER_DEFAULTS.SUCCESS_THRESHOLD).toBe(2);
      expect(CIRCUIT_BREAKER_DEFAULTS.FAILURE_WINDOW_MS).toBe(60000);
    });

    it('failure status codes include server errors', () => {
      expect(CIRCUIT_BREAKER_DEFAULTS.FAILURE_STATUS_CODES).toContain(500);
      expect(CIRCUIT_BREAKER_DEFAULTS.FAILURE_STATUS_CODES).toContain(503);
    });

    it('counts network errors by default', () => {
      expect(CIRCUIT_BREAKER_DEFAULTS.COUNT_NETWORK_ERRORS).toBe(true);
    });
  });

  describe('WEBHOOK_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(WEBHOOK_DEFAULTS.PORT).toBe(3000);
      expect(WEBHOOK_DEFAULTS.HOST).toBe('0.0.0.0');
      expect(WEBHOOK_DEFAULTS.DEFAULT_TIMEOUT_MS).toBe(300000);
      expect(WEBHOOK_DEFAULTS.CLEANUP_INTERVAL_MS).toBe(60000);
    });

    it('port is a valid port number', () => {
      expect(WEBHOOK_DEFAULTS.PORT).toBeGreaterThan(0);
      expect(WEBHOOK_DEFAULTS.PORT).toBeLessThan(65536);
    });
  });

  describe('STORE_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(STORE_DEFAULTS.DATA_DIR).toBe('.reqon-data');
      expect(STORE_DEFAULTS.EXECUTIONS_DIR).toBe('executions');
      expect(STORE_DEFAULTS.SYNC_DIR).toBe('sync');
    });
  });

  describe('SCHEDULER_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(SCHEDULER_DEFAULTS.MAX_RETRIES).toBe(3);
      expect(SCHEDULER_DEFAULTS.RETRY_DELAY_SECONDS).toBe(60);
    });
  });

  describe('EXECUTION_DEFAULTS', () => {
    it('has sensible default values', () => {
      expect(typeof EXECUTION_DEFAULTS.DEVELOPMENT_MODE).toBe('boolean');
      expect(typeof EXECUTION_DEFAULTS.PERSIST_STATE).toBe('boolean');
    });
  });
});
