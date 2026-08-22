import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { safeJoin, sanitizeSegment, PathTraversalError } from './path.js';

describe('safeJoin', () => {
  it('joins a normal segment under the base', () => {
    expect(safeJoin('.reqon-data', 'users.json')).toBe(resolve('.reqon-data', 'users.json'));
  });

  it('allows nested segments that stay inside the base', () => {
    expect(safeJoin('.reqon-data', 'traces', 'abc', 'meta.json')).toBe(
      resolve('.reqon-data', 'traces', 'abc', 'meta.json')
    );
  });

  it('rejects parent-directory traversal', () => {
    expect(() => safeJoin('.reqon-data', '../secret.json')).toThrow(PathTraversalError);
  });

  it('rejects deep traversal that escapes the base', () => {
    expect(() => safeJoin('.reqon-data', '../../etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects absolute path segments', () => {
    expect(() => safeJoin('.reqon-data', '/etc/passwd')).toThrow(PathTraversalError);
  });

  it('allows a segment that resolves to the base itself', () => {
    expect(safeJoin('.reqon-data', '.')).toBe(resolve('.reqon-data'));
  });
});

describe('sanitizeSegment', () => {
  it('passes through a clean segment', () => {
    expect(sanitizeSegment('users')).toBe('users');
  });

  it('rejects forward-slash separators', () => {
    expect(() => sanitizeSegment('a/b')).toThrow(PathTraversalError);
  });

  it('rejects backslash separators', () => {
    expect(() => sanitizeSegment('a\\b')).toThrow(PathTraversalError);
  });

  it('rejects traversal segments', () => {
    expect(() => sanitizeSegment('..')).toThrow(PathTraversalError);
    expect(() => sanitizeSegment('.')).toThrow(PathTraversalError);
  });

  it('rejects empty segments', () => {
    expect(() => sanitizeSegment('')).toThrow(PathTraversalError);
  });

  it('rejects null bytes', () => {
    expect(() => sanitizeSegment('a\0b')).toThrow(PathTraversalError);
  });
});
