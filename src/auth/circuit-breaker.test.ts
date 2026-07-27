import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from './circuit-breaker.js';

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

    it('admits only a single probe at a time (no recovery stampede)', async () => {
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 50,
        successThreshold: 2,
      });
      breaker.recordFailure('TestAPI', undefined, 500);

      await new Promise((resolve) => setTimeout(resolve, 60));

      // First caller becomes the probe and is admitted.
      expect(breaker.canProceed('TestAPI')).toBe(true);
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');

      // Every concurrent caller is denied while the probe is in flight.
      expect(breaker.canProceed('TestAPI')).toBe(false);
      expect(breaker.canProceed('TestAPI')).toBe(false);
    });

    it('releases the probe slot for the next probe after a partial success', () => {
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 0,
        successThreshold: 2,
      });
      breaker.recordFailure('TestAPI', undefined, 500);

      // resetTimeout 0 => immediately eligible for half-open.
      expect(breaker.canProceed('TestAPI')).toBe(true); // probe 1 admitted
      expect(breaker.canProceed('TestAPI')).toBe(false); // blocked while in flight

      breaker.recordSuccess('TestAPI'); // probe 1 succeeds (1 of 2)
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');

      // Slot released — the next probe is admitted, others still blocked.
      expect(breaker.canProceed('TestAPI')).toBe(true); // probe 2 admitted
      expect(breaker.canProceed('TestAPI')).toBe(false);

      breaker.recordSuccess('TestAPI'); // probe 2 succeeds (2 of 2) => closed
      expect(breaker.getStatus('TestAPI').state).toBe('closed');
    });

    // Regression coverage for #247: an uncounted (4xx) failure during a probe
    // used to hit recordFailure's early return without releasing the probe slot,
    // leaving the circuit stuck in half-open forever.
    it('releases the probe slot when a probe fails with an uncounted status', async () => {
      breaker.configure('TestAPI', { failureThreshold: 1, resetTimeout: 1 });
      breaker.recordFailure('TestAPI', undefined, 500);
      expect(breaker.getStatus('TestAPI').state).toBe('open');

      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(breaker.canProceed('TestAPI')).toBe(true); // takes the probe slot
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');

      // 403 is not a counted failure status, so it must not re-open the circuit,
      // but it must release the probe slot rather than wedging half-open.
      breaker.recordFailure('TestAPI', undefined, 403);
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');

      // The next request is admitted as a fresh probe instead of being stuck.
      expect(breaker.canProceed('TestAPI')).toBe(true);
    });

    it('self-heals a lost probe release after probeTimeout', async () => {
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 1,
        probeTimeout: 20,
      });
      breaker.recordFailure('TestAPI', undefined, 500);

      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(breaker.canProceed('TestAPI')).toBe(true); // probe admitted
      // Simulate a probe whose outcome is never reported (request threw before
      // recordSuccess/recordFailure): the slot stays claimed.
      expect(breaker.canProceed('TestAPI')).toBe(false);

      // After probeTimeout the stale slot expires and a new probe is admitted.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(breaker.canProceed('TestAPI')).toBe(true);
    });
  });

  describe('memory hygiene (read paths do not insert)', () => {
    it('getStatus on an unknown key does not create an entry', () => {
      breaker.getStatus('UnknownAPI', '/unknown');
      expect(breaker.getAllStatuses().size).toBe(0);
    });

    it('canProceed on an unknown key does not create an entry', () => {
      expect(breaker.canProceed('UnknownAPI', '/unknown')).toBe(true);
      expect(breaker.getAllStatuses().size).toBe(0);
    });

    it('recordSuccess on an unknown key does not create an entry', () => {
      breaker.recordSuccess('UnknownAPI', '/unknown');
      expect(breaker.getAllStatuses().size).toBe(0);
    });

    it('evictStale removes idle closed circuits but keeps open ones', async () => {
      breaker.configure('OpenAPI', { failureThreshold: 1, resetTimeout: 60000 });
      breaker.recordFailure('OpenAPI', undefined, 500); // -> open
      breaker.recordSuccess('ClosedAPI'); // no entry (read-only)
      breaker.recordFailure('ClosedAPI', undefined, 404); // not a failure status -> no entry
      breaker.recordFailure('FlakyAPI', undefined, 500); // closed, 1 failure

      // Let activity age, then evict anything idle longer than 10ms.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const evicted = breaker.evictStale(10);

      const statuses = breaker.getAllStatuses();
      expect(statuses.has('OpenAPI')).toBe(true); // open circuits retained
      expect(statuses.has('FlakyAPI')).toBe(false); // idle closed circuit evicted
      expect(evicted).toBe(1);
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

    it('uses source-level config for proxy lane keys', () => {
      breaker.configure('TestAPI', { failureThreshold: 2 });

      breaker.recordFailure('TestAPI@proxy-a:3128', undefined, 500);
      breaker.recordFailure('TestAPI@proxy-a:3128', undefined, 500);

      // Without the lane fallback this runs on the default threshold of 5
      // and the circuit stays closed.
      expect(breaker.canProceed('TestAPI@proxy-a:3128')).toBe(false);
      expect(breaker.canProceed('TestAPI@proxy-b:3128')).toBe(true);
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

    it('honors lane-configured countNetworkErrors on lane-keyed failures', () => {
      // Config is stored under the bare source name, but http.ts keys the
      // breaker per egress lane (`source@host:port`). recordFailure must fall
      // back through the lane source when resolving config, or it would use the
      // default (countNetworkErrors: true) and open despite the config.
      breaker.configure('TestAPI', { failureThreshold: 1, countNetworkErrors: false });

      breaker.recordFailure('TestAPI@10.0.0.1:443', undefined, undefined, true);

      expect(breaker.getStatus('TestAPI@10.0.0.1:443').state).toBe('closed');
    });

    it('honors lane-configured failureStatusCodes on lane-keyed failures', () => {
      breaker.configure('TestAPI', { failureThreshold: 1, failureStatusCodes: [429] });

      // 500 is not in the lane's custom list, so it must not open the circuit.
      breaker.recordFailure('TestAPI@10.0.0.1:443', undefined, 500);
      expect(breaker.getStatus('TestAPI@10.0.0.1:443').state).toBe('closed');

      // 429 is, so it opens.
      breaker.recordFailure('TestAPI@10.0.0.1:443', undefined, 429);
      expect(breaker.getStatus('TestAPI@10.0.0.1:443').state).toBe('open');
    });
  });

  describe('half-open probe slot release', () => {
    it('releases the probe slot when a half-open probe fails un-counted', async () => {
      // With countNetworkErrors off, a network error during the half-open probe
      // is not counted. It must still free the single probe slot, or the circuit
      // stays half-open forever and never admits another probe.
      breaker.configure('TestAPI', {
        failureThreshold: 1,
        resetTimeout: 30,
        successThreshold: 1,
        countNetworkErrors: false,
      });

      breaker.recordFailure('TestAPI', undefined, 500); // open
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(breaker.canProceed('TestAPI')).toBe(true); // admits the probe (half-open)
      expect(breaker.getStatus('TestAPI').state).toBe('half_open');

      // Probe fails with an un-counted network error.
      breaker.recordFailure('TestAPI', undefined, undefined, true);

      // The slot is released: a subsequent request is admitted as the next probe
      // (rather than being denied forever), and can then close the circuit.
      expect(breaker.canProceed('TestAPI')).toBe(true);
      breaker.recordSuccess('TestAPI');
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

describe('failure rate threshold', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker();
  });

  /**
   * An absolute count cannot be tuned for a bulk run: at a few thousand
   * requests a second, five failures is a rounding error, not an outage.
   */
  it('stays closed when failures are a small fraction of traffic', () => {
    breaker.configure('Bulk', { failureRate: 50, minimumRequests: 100 });

    for (let i = 0; i < 500; i++) breaker.recordSuccess('Bulk');
    for (let i = 0; i < 20; i++) breaker.recordFailure('Bulk', undefined, 500);

    expect(breaker.canProceed('Bulk')).toBe(true);
  });

  it('opens once failures pass the configured share of traffic', () => {
    breaker.configure('Bulk', { failureRate: 50, minimumRequests: 100 });

    for (let i = 0; i < 60; i++) breaker.recordSuccess('Bulk');
    for (let i = 0; i < 61; i++) breaker.recordFailure('Bulk', undefined, 500);

    expect(breaker.canProceed('Bulk')).toBe(false);
  });

  it('ignores the rate until the sample is big enough to mean anything', () => {
    breaker.configure('Bulk', { failureRate: 50, minimumRequests: 100 });

    // 100% failure, but only 3 requests - not evidence of an outage.
    for (let i = 0; i < 3; i++) breaker.recordFailure('Bulk', undefined, 500);

    expect(breaker.canProceed('Bulk')).toBe(true);
  });

  it('still honours an absolute threshold when no rate is configured', () => {
    breaker.configure('Legacy', { failureThreshold: 3 });

    for (let i = 0; i < 3; i++) breaker.recordFailure('Legacy', undefined, 500);

    expect(breaker.canProceed('Legacy')).toBe(false);
  });
});
