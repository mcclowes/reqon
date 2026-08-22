import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic, writeFileAtomicSync, writeJsonFile, readJsonFile } from './file.js';

describe('atomic file writes', () => {
  const DIR = '.reqon-test-file-utils';
  const target = join(DIR, 'data.json');

  beforeEach(() => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('writeFileAtomic writes the content', async () => {
    await writeFileAtomic(target, 'hello');
    expect(readFileSync(target, 'utf-8')).toBe('hello');
  });

  it('writeFileAtomic leaves no temp files behind', async () => {
    await writeFileAtomic(target, 'hello');
    const leftover = readdirSync(DIR).filter((f) => f.endsWith('.tmp'));
    expect(leftover).toHaveLength(0);
  });

  it('writeFileAtomicSync writes the content', () => {
    writeFileAtomicSync(target, 'world');
    expect(readFileSync(target, 'utf-8')).toBe('world');
  });

  it('writeJsonFile round-trips via readJsonFile', async () => {
    await writeJsonFile(target, { a: 1, b: [2, 3] });
    expect(await readJsonFile(target)).toEqual({ a: 1, b: [2, 3] });
  });
});

describe('readJsonFile', () => {
  const DIR = '.reqon-test-file-utils-read';
  const target = join(DIR, 'data.json');

  beforeEach(() => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('returns null when the file is absent', async () => {
    expect(await readJsonFile(join(DIR, 'missing.json'))).toBeNull();
  });

  it('throws (does not return null) when the file is corrupt', async () => {
    writeFileSync(target, '{ "truncated": ');
    await expect(readJsonFile(target)).rejects.toThrow(/corrupt json/i);
  });
});
