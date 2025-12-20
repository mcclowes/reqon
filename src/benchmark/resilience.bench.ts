/**
 * Resilience component benchmarks (Circuit Breaker and Rate Limiter)
 */

import { CircuitBreaker } from '../auth/circuit-breaker.js';
import { AdaptiveRateLimiter } from '../auth/rate-limiter.js';
import { BenchmarkSuite } from './utils.js';

export async function runResilienceBenchmarks(): Promise<void> {
  // Circuit Breaker benchmarks
  const cbSuite = new BenchmarkSuite('CircuitBreaker');

  // Basic operations in closed state
  const closedBreaker = new CircuitBreaker();

  cbSuite.addSync('canProceed-closed', () => {
    return closedBreaker.canProceed('test-source', '/endpoint');
  });

  cbSuite.addSync('ensureCanProceed-closed', () => {
    closedBreaker.ensureCanProceed('test-source', '/endpoint');
  });

  cbSuite.addSync('recordSuccess-closed', () => {
    closedBreaker.recordSuccess('test-source', '/endpoint');
  });

  cbSuite.addSync('recordFailure-closed', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1000 }); // High threshold to stay closed
    breaker.recordFailure('test-source', '/endpoint');
  });

  // Configure operation
  cbSuite.addSync('configure', () => {
    const breaker = new CircuitBreaker();
    breaker.configure('new-source', {
      failureThreshold: 10,
      resetTimeout: 60000,
    });
  });

  // State transition to open
  cbSuite.addSync('transition-to-open', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure('source', '/ep');
    breaker.recordFailure('source', '/ep');
    breaker.recordFailure('source', '/ep');
    return breaker.getStatus('source', '/ep');
  });

  // Multiple sources/endpoints
  cbSuite.addSync('multi-source-check', () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 10; i++) {
      breaker.canProceed(`source-${i}`, `/endpoint-${i}`);
    }
  });

  // Simulate realistic request pattern
  cbSuite.addSync('realistic-request-pattern', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    // 80% success, 20% failure
    for (let i = 0; i < 100; i++) {
      breaker.ensureCanProceed('api', '/data');
      if (Math.random() > 0.2) {
        breaker.recordSuccess('api', '/data');
      } else {
        breaker.recordFailure('api', '/data');
      }
    }
  }, { iterations: 100 });

  cbSuite.print();

  // Rate Limiter benchmarks
  const rlSuite = new BenchmarkSuite('AdaptiveRateLimiter');

  const limiter = new AdaptiveRateLimiter();

  await rlSuite.addAsync('canProceed-fresh', async () => {
    const rl = new AdaptiveRateLimiter();
    return await rl.canProceed('api', '/endpoint');
  });

  await rlSuite.addAsync('canProceed-existing', async () => {
    return await limiter.canProceed('test-api', '/test-endpoint');
  });

  // Configure operation
  rlSuite.addSync('configure', () => {
    const rl = new AdaptiveRateLimiter();
    rl.configure('api', {
      strategy: 'pause',
      maxWait: 60,
      notifyAt: 5,
      fallbackRpm: 100,
    });
  });

  // Handle response with rate limit headers
  const headersWithRateLimit = new Headers({
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': '50',
    'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
  });

  await rlSuite.addAsync('handleResponse-with-headers', async () => {
    const rl = new AdaptiveRateLimiter();
    await rl.handleResponse('api', '/endpoint', {
      status: 200,
      ok: true,
      headers: headersWithRateLimit,
    } as Response);
  });

  // Handle response without headers
  await rlSuite.addAsync('handleResponse-no-headers', async () => {
    const rl = new AdaptiveRateLimiter();
    await rl.handleResponse('api', '/endpoint', {
      status: 200,
      ok: true,
      headers: new Headers(),
    } as Response);
  });

  // Handle 429 response
  const headers429 = new Headers({
    'Retry-After': '60',
  });

  await rlSuite.addAsync('handleResponse-429', async () => {
    const rl = new AdaptiveRateLimiter();
    await rl.handleResponse('api', '/endpoint', {
      status: 429,
      ok: false,
      headers: headers429,
    } as Response);
  });

  // getStatus operation
  await rlSuite.addAsync('getStatus', async () => {
    return limiter.getStatus('test-api', '/test-endpoint');
  });

  // Multiple endpoints check
  await rlSuite.addAsync('multi-endpoint-check', async () => {
    const rl = new AdaptiveRateLimiter();
    for (let i = 0; i < 10; i++) {
      await rl.canProceed(`source-${i}`, `/endpoint-${i}`);
    }
  });

  // Simulate realistic request pattern
  await rlSuite.addAsync('realistic-request-pattern', async () => {
    const rl = new AdaptiveRateLimiter();
    const headers = new Headers({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '95',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
    });

    for (let i = 0; i < 20; i++) {
      await rl.canProceed('api', '/data');
      headers.set('X-RateLimit-Remaining', String(95 - i));
      await rl.handleResponse('api', '/data', {
        status: 200,
        ok: true,
        headers,
      } as Response);
    }
  }, { iterations: 100 });

  rlSuite.print();

  // Combined resilience pattern
  const combinedSuite = new BenchmarkSuite('Combined Resilience Pattern');

  await combinedSuite.addAsync('circuit-breaker-plus-rate-limiter', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    const rl = new AdaptiveRateLimiter();

    // Simulate 50 requests
    for (let i = 0; i < 50; i++) {
      // Check circuit breaker
      try {
        cb.ensureCanProceed('api', '/data');
      } catch {
        continue;
      }

      // Check rate limiter
      if (!(await rl.canProceed('api', '/data'))) {
        continue;
      }

      // Simulate response
      const success = Math.random() > 0.1;
      if (success) {
        cb.recordSuccess('api', '/data');
        await rl.handleResponse('api', '/data', {
          status: 200,
          ok: true,
          headers: new Headers({
            'X-RateLimit-Remaining': '50',
          }),
        } as Response);
      } else {
        cb.recordFailure('api', '/data');
      }
    }
  }, { iterations: 100 });

  combinedSuite.print();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runResilienceBenchmarks().catch(console.error);
}
