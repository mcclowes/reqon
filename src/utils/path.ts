/**
 * Utility functions for path traversal and value extraction
 */

import { join, resolve, sep } from 'node:path';

/**
 * Extract a nested value from an object using dot notation path
 * @example extractNestedValue({ a: { b: 1 } }, 'a.b') // => 1
 */
export function extractNestedValue(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let value: unknown = data;

  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Error thrown when a path segment would escape its base directory.
 */
export class PathTraversalError extends Error {
  constructor(
    public readonly segment: string,
    public readonly baseDir: string
  ) {
    super(`Path segment "${segment}" escapes base directory "${baseDir}"`);
    this.name = 'PathTraversalError';
  }
}

/**
 * Safely join an untrusted path segment under a base directory, asserting the
 * result stays confined inside that base. Guards against `../`, absolute paths,
 * and embedded separators in store names / IDs.
 *
 * @throws {PathTraversalError} if the resolved path escapes baseDir
 */
export function safeJoin(baseDir: string, ...segments: string[]): string {
  const base = resolve(baseDir);
  const joined = resolve(base, ...segments);
  // Confined if it equals the base or sits inside it (base + separator prefix).
  if (joined !== base && !joined.startsWith(base + sep)) {
    throw new PathTraversalError(join(...segments), baseDir);
  }
  return joined;
}

/**
 * Sanitize a single untrusted path segment (e.g. a store name or record ID) so
 * it cannot traverse directories. Rejects empty, separator-bearing, or
 * traversal segments rather than silently mangling them.
 *
 * @throws {PathTraversalError} if the segment is unsafe
 */
export function sanitizeSegment(segment: string, baseDir = '.'): string {
  if (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new PathTraversalError(segment, baseDir);
  }
  return segment;
}
export function traversePath(
  parts: string[],
  current: unknown,
  fallbackLookup?: (key: string) => unknown
): unknown {
  let value = current;

  for (let i = 0; i < parts.length; i++) {
    if (value && typeof value === 'object' && value !== null) {
      value = (value as Record<string, unknown>)[parts[i]];
    } else if (i === 0 && fallbackLookup) {
      // Try fallback for first part
      value = fallbackLookup(parts[0]);
      if (value === undefined) return undefined;
    } else {
      return undefined;
    }
  }

  return value;
}
