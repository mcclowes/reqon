import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  resolveWithinWorkingDir,
  resolveDryRun,
  withTimeout,
  ExecutionTimeoutError,
  isStoreTypeAllowed,
} from './sandbox.js';

describe('resolveWithinWorkingDir', () => {
  const base = '/tmp/reqon-work';

  it('resolves a relative path under the working dir', () => {
    expect(resolveWithinWorkingDir(base, 'mission.vague')).toBe(resolve(base, 'mission.vague'));
  });

  it('allows nested paths inside the working dir', () => {
    expect(resolveWithinWorkingDir(base, 'a/b/mission.vague')).toBe(
      resolve(base, 'a/b/mission.vague')
    );
  });

  it('rejects parent-directory traversal', () => {
    expect(() => resolveWithinWorkingDir(base, '../../etc/passwd')).toThrow(/escapes/);
  });

  it('rejects absolute paths outside the working dir', () => {
    expect(() => resolveWithinWorkingDir(base, '/etc/passwd')).toThrow(/escapes/);
  });
});

describe('resolveDryRun', () => {
  it('forces dryRun when effects are not allowed', () => {
    expect(resolveDryRun(false, false)).toBe(true);
    expect(resolveDryRun(false, undefined)).toBe(true);
    expect(resolveDryRun(false, true)).toBe(true);
  });

  it('honors the requested dryRun when effects are allowed', () => {
    expect(resolveDryRun(true, false)).toBe(false);
    expect(resolveDryRun(true, true)).toBe(true);
    expect(resolveDryRun(true, undefined)).toBe(false);
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('propagates rejection from the underlying promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with ExecutionTimeoutError when the promise hangs', async () => {
    const hang = new Promise<never>(() => {}); // never settles
    await expect(withTimeout(hang, 10)).rejects.toBeInstanceOf(ExecutionTimeoutError);
  });

  it('disables the guard for a non-positive timeout', async () => {
    await expect(withTimeout(Promise.resolve(42), 0)).resolves.toBe(42);
  });
});

describe('isStoreTypeAllowed', () => {
  it('always allows memory stores', () => {
    expect(isStoreTypeAllowed('memory', false)).toBe(true);
    expect(isStoreTypeAllowed('memory', true)).toBe(true);
    expect(isStoreTypeAllowed(undefined, false)).toBe(true);
  });

  it('only allows file stores when effects are enabled', () => {
    expect(isStoreTypeAllowed('file', false)).toBe(false);
    expect(isStoreTypeAllowed('file', true)).toBe(true);
  });
});
