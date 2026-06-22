import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { resolveWithinWorkingDir, resolveDryRun } from './sandbox.js';

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
