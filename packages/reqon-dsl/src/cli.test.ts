import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAuthFile, reportFatalError } from './cli.js';
import { ReqonError } from './errors/index.js';

describe('loadAuthFile', () => {
  it('throws a clean "auth file not found" message for a missing file', async () => {
    await expect(loadAuthFile('./definitely-missing-auth.json')).rejects.toThrow(
      /auth file not found/
    );
  });

  it('does not leak a raw fs stack-trace message', async () => {
    await expect(loadAuthFile('./definitely-missing-auth.json')).rejects.not.toThrow(/ENOENT/);
  });

  it('throws a clean message for invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reqon-auth-'));
    const path = join(dir, 'bad.json');
    await writeFile(path, '{ not valid json ');
    try {
      await expect(loadAuthFile(path)).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads and resolves a valid auth file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reqon-auth-'));
    const path = join(dir, 'auth.json');
    await writeFile(path, JSON.stringify({ github: { type: 'bearer', token: 'abc' } }));
    try {
      const auth = await loadAuthFile(path);
      expect(auth).toMatchObject({ github: { type: 'bearer', token: 'abc' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('reportFatalError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats a ReqonError via its format() method', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new ReqonError('boom', { line: 1, column: 1 });
    reportFatalError(err);
    expect(spy).toHaveBeenCalledWith(err.format());
  });

  it('prints a clean one-line message for a plain Error (no stack)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportFatalError(new Error('auth file not found: /x.json'));
    expect(spy).toHaveBeenCalledWith('Error: auth file not found: /x.json');
  });

  it('handles non-Error throwables', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportFatalError('a string failure');
    expect(spy).toHaveBeenCalledWith('Error: a string failure');
  });
});
