import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerError,
  type CircuitBreakerCallbacks,
} from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker();
  });

  describe('closed state (default)', () => {
    it('allows requests when circuit is closed', () => {
      expect(breaker.canProceed('TestAPI')).toBe(true);
    });

    it('reports closed state in status', () => {
      const status = breaker.getStatus('TestAPI');
      expect(status.state).toBe('closed');
      expect(status.isOpen).toBe(false);
      expect(status.failures).toBe(0);
    });

    it('tracks failures within window', () => {
      breaker.recordFailure('TestAPI', undefined, 500);
      breaker.recordFailure('TestAPI', undefined, 502);

      const status = breaker.getStatus('TestAPI');
      expect(status.failures).toBe(2);
      expect(status.state).toBe('closed');
    });

    it('counts network errors as failures', () => {
      breaker.recordFailure('TestAPI', undefined, undefined, true);
      breaker.recordFailure('TestAPI', undefined, undefined, true);

      const status = breaker.getStatus('TestAPI');
      expect(status.failures).toBe(2);
    });

    it('does not count non-failure status codes', () => {
      breaker.recordFailure('TestAPI', undefined, 400);
      breaker.recordFailure('TestAPI', undefined, 404);

      const status = breaker.getStatus('TestAPI');
      expect(status.failures).toBe(0);
    });
  });

  describe('opening circuit', () => {
    it('opens circuit after reaching failure threshold', () => {
      // Default threshold is 5
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure('TestAPI', undefined, 500);
      }

      const status = breaker.getStatus('TestAPI');
      expect(status.state).toBe('open');
      expect(status.isOpen).toBe(true);
    });

    it('respects custom failure threshold', () => {
      breaker.configure('TestAPI', { failureThreshold: 3 });

      breaker.recordFailure('TestAPI', undefined, 500);
      breaker.recordFailure('TestAPI', undefined, 500);
      expect(breaker.getStatus('TestAPI').state).toBe('closed');

      breaker.recordFailure('TestAPI', undefined, 500);
      expect(breaker.getStatus('TestAPI').state).toBe('open');
    });

    it('rejects requests when circuit is open', () => {
      breaker.configure('TestAPI', { failureThreshold: 1 });
      breaker.recordFailure('TestAPI', undefined, 500);

      expect(breaker.canProceed('TestAPI')).toBe(false);
    });

    it('throws CircuitBreakerError when ensureCanProceed is called on open circuit', () => {
      breaker.configure('TestAPI', { failureThreshold: 1 });
      breaker.recordFailure('TestAPI', undefined, 500);

      expect(() => breaker.ensureCanProceed('TestAPI')).toThrow(CircuitBreakerError);
    });

    it('includes retry information in CircuitBreakerError', () => {
      breaker.configure('TestAPI', { failureThreshold: 1, resetTimeout: 30000 });
      breaker.recordFailure('TestAPI', undefined, 500);

      try {
        breaker.ensureCanProceed('TestAPI');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerError);
        const cbError = error as CircuitBreakerError;
        expect(cbError.source).toBe('TestAPI');
        expect(cbError.nextAttemptIn).toBeGreaterThan(0);
        expect(cbError.nextAttemptIn).toBeLessThanOrEqual(30000);
      }
    });
  });

  describe('half-open state', () => {
    it('transitions to half-open after reset timeout', async () => {
      breaker.configure('TestAPI', { failureThreshold: 1, resetTimeout: 50 });
      breaker.recordFailure('TestAPI', undefined, 500);

      expect(breaker.getStatus('TestAPI').state).toBe('open');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // canProceed should transition to half-open
      expect(breaker.canProceed('TestAPI')).toBe(true);
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');
    });

    it('closes circuit after success threshold in half-open', async () => {
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 50,
        successThreshold: 2,
      });
      breaker.recordFailure('TestAPI', undefined, 500);

      await new Promise((resolve) => setTimeout(resolve, 60));
      breaker.canProceed('TestAPI'); // Trigger transition to half-open

      breaker.recordSuccess('TestAPI');
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');

      breaker.recordSuccess('TestAPI');
      expect(breaker.getStatus('TestAPI').state).toBe('closed');
    });

    it('re-opens circuit on any failure in half-open', async () => {
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 50,
        successThreshold: 2,
      });
      breaker.recordFailure('TestAPI', undefined, 500);

      await new Promise((resolve) => setTimeout(resolve, 60));
      breaker.canProceed('TestAPI'); // Trigger transition to half-open

      // One success, then a failure
      breaker.recordSuccess('TestAPI');
      breaker.recordFailure('TestAPI', undefined, 500);

      expect(breaker.getStatus('TestAPI').state).toBe('open');
    });
  });

  describe('failure window', () => {
    it('prunes old failures outside window', async () => {
      breaker.configure('TestAPI', { failureThreshold: 3, failureWindow: 100 });

      breaker.recordFailure('TestAPI', undefined, 500);
      breaker.recordFailure('TestAPI', undefined, 500);

      // Wait for failures to age out
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Record a new failure - old ones should be pruned
      breaker.recordFailure('TestAPI', undefined, 500);

      const status = breaker.getStatus('TestAPI');
      expect(status.failures).toBe(1);
      expect(status.state).toBe('closed');
    });

    it('does not open circuit if failures are spread across windows', async () => {
      breaker.configure('TestAPI', { failureThreshold: 3, failureWindow: 50 });

      breaker.recordFailure('TestAPI', undefined, 500);
      await new Promise((resolve) => setTimeout(resolve, 60));

      breaker.recordFailure('TestAPI', undefined, 500);
      await new Promise((resolve) => setTimeout(resolve, 60));

      breaker.recordFailure('TestAPI', undefined, 500);

      // Each failure was in a different window, so should not open
      expect(breaker.getStatus('TestAPI').state).toBe('closed');
    });
  });

  describe('per-endpoint tracking', () => {
    it('tracks failures per endpoint', () => {
      breaker.configure('TestAPI', { failureThreshold: 2 });

      breaker.recordFailure('TestAPI', '/invoices', 500);
      breaker.recordFailure('TestAPI', '/invoices', 500);
      breaker.recordFailure('TestAPI', '/contacts', 500);

      expect(breaker.canProceed('TestAPI', '/invoices')).toBe(false);
      expect(breaker.canProceed('TestAPI', '/contacts')).toBe(true);
    });

    it('uses source-level config for endpoints', () => {
      breaker.configure('TestAPI', { failureThreshold: 1 });

      breaker.recordFailure('TestAPI', '/invoices', 500);

      expect(breaker.canProceed('TestAPI', '/invoices')).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets circuit to closed state', () => {
      breaker.configure('TestAPI', { failureThreshold: 1 });
      breaker.recordFailure('TestAPI', undefined, 500);

      expect(breaker.getStatus('TestAPI').state).toBe('open');

      breaker.reset('TestAPI');

      const status = breaker.getStatus('TestAPI');
      expect(status.state).toBe('closed');
      expect(status.failures).toBe(0);
    });

    it('resets specific endpoint', () => {
      breaker.configure('TestAPI', { failureThreshold: 1 });
      breaker.recordFailure('TestAPI', '/invoices', 500);
      breaker.recordFailure('TestAPI', '/contacts', 500);

      breaker.reset('TestAPI', '/invoices');

      expect(breaker.canProceed('TestAPI', '/invoices')).toBe(true);
      expect(breaker.canProceed('TestAPI', '/contacts')).toBe(false);
    });
  });

  describe('custom failure status codes', () => {
    it('uses custom failure status codes', () => {
      breaker.configure('TestAPI', {
        failureThreshold: 2,
        failureStatusCodes: [503, 504],
      });

      breaker.recordFailure('TestAPI', undefined, 500); // Not counted
      breaker.recordFailure('TestAPI', undefined, 503);
      breaker.recordFailure('TestAPI', undefined, 504);

      expect(breaker.getStatus('TestAPI').state).toBe('open');
    });
  });

  describe('network error handling', () => {
    it('respects countNetworkErrors setting', () => {
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        countNetworkErrors: false,
      });

      breaker.recordFailure('TestAPI', undefined, undefined, true);

      expect(breaker.getStatus('TestAPI').state).toBe('closed');
    });
  });

  describe('callbacks', () => {
    it('calls onOpen when circuit opens', () => {
      const onOpen = vi.fn();
      breaker.setCallbacks({ onOpen });
      breaker.configure('TestAPI', { failureThreshold: 1 });

      breaker.recordFailure('TestAPI', undefined, 500);

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TestAPI',
          state: 'open',
          previousState: 'closed',
        })
      );
    });

    it('calls onHalfOpen when transitioning to half-open', async () => {
      const onHalfOpen = vi.fn();
      breaker.setCallbacks({ onHalfOpen });
      breaker.configure('TestAPI', { failureThreshold: 1, resetTimeout: 50 });

      breaker.recordFailure('TestAPI', undefined, 500);
      await new Promise((resolve) => setTimeout(resolve, 60));
      breaker.canProceed('TestAPI');

      expect(onHalfOpen).toHaveBeenCalledTimes(1);
      expect(onHalfOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TestAPI',
          state: 'half_open',
          previousState: 'open',
        })
      );
    });

    it('calls onClose when circuit closes', async () => {
      const onClose = vi.fn();
      breaker.setCallbacks({ onClose });
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 50,
        successThreshold: 1,
      });

      breaker.recordFailure('TestAPI', undefined, 500);
      await new Promise((resolve) => setTimeout(resolve, 60));
      breaker.canProceed('TestAPI');
      breaker.recordSuccess('TestAPI');

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TestAPI',
          state: 'closed',
          previousState: 'half_open',
        })
      );
    });

    it('calls onRejected when request is rejected', () => {
      const onRejected = vi.fn();
      breaker.setCallbacks({ onRejected });
      breaker.configure('TestAPI', { failureThreshold: 1 });

      breaker.recordFailure('TestAPI', undefined, 500);

      try {
        breaker.ensureCanProceed('TestAPI');
      } catch {
        // Expected
      }

      expect(onRejected).toHaveBeenCalledTimes(1);
      expect(onRejected).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TestAPI',
          nextAttemptIn: expect.any(Number),
        })
      );
    });
  });

  describe('getAllStatuses', () => {
    it('returns all circuit statuses', () => {
      breaker.configure('API1', { failureThreshold: 1 });
      breaker.configure('API2', { failureThreshold: 1 });

      breaker.recordFailure('API1', undefined, 500);
      breaker.recordSuccess('API2');

      const statuses = breaker.getAllStatuses();

      expect(statuses.size).toBe(2);
      expect(statuses.get('API1')?.state).toBe('open');
      expect(statuses.get('API2')?.state).toBe('closed');
    });
  });

  describe('default configuration', () => {
    it('uses default config when not configured', () => {
      // 5 failures needed by default
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure('TestAPI', undefined, 500);
      }
      expect(breaker.getStatus('TestAPI').state).toBe('closed');

      breaker.recordFailure('TestAPI', undefined, 500);
      expect(breaker.getStatus('TestAPI').state).toBe('open');
    });

    it('allows setting default config via constructor', () => {
      const customBreaker = new CircuitBreaker({ failureThreshold: 2 });

      customBreaker.recordFailure('TestAPI', undefined, 500);
      expect(customBreaker.getStatus('TestAPI').state).toBe('closed');

      customBreaker.recordFailure('TestAPI', undefined, 500);
      expect(customBreaker.getStatus('TestAPI').state).toBe('open');
    });
  });
});
