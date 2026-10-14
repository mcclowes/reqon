/**
 * Utility functions for path traversal and value extraction
 */

import { resolve, sep } from 'node:path';

/**
 * Validate that a user-influenced path segment (a store name or record ID)
 * cannot escape its base directory.
 *
 * Store names and record IDs originate from the DSL or from fetched data, so a
 * value like `../../etc/passwd`, an absolute path, or one containing path
 * separators would otherwise be joined straight into a filesystem path and
 * read/write arbitrary files outside `.reqon-data`. We reject any segment that
 * contains a path separator, a `..` component, a null byte, or that resolves
 * outside the base directory.
 *
 * @throws Error if the segment is unsafe
 */
export function assertSafePathSegment(segment: string, label = 'path segment'): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty string`);
  }

  // Null bytes can truncate paths in some syscalls
  if (segment.includes('\0')) {
    throw new Error(`Invalid ${label}: contains a null byte`);
  }

  // Reject any path separator (POSIX or Windows) and parent-directory traversal
  if (segment.includes('/') || segment.includes('\\')) {
    throw new Error(`Invalid ${label} "${segment}": must not contain path separators`);
  }

  // Reject `.` and `..` as whole segments (would escape or alias the directory)
  if (segment === '.' || segment === '..') {
    throw new Error(`Invalid ${label} "${segment}": must not be "." or ".."`);
  }

  return segment;
}

/**
 * Resolve a child path within a base directory, asserting it stays confined.
 *
 * Defence in depth on top of {@link assertSafePathSegment}: even if a caller
 * constructs a path some other way, this guarantees the resolved absolute path
 * is inside `baseDir` (or equal to it).
 *
 * @throws Error if the resolved path escapes the base directory
 */
export function resolveWithin(baseDir: string, childPath: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedChild = resolve(resolvedBase, childPath);

  const baseWithSep = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;
  if (resolvedChild !== resolvedBase && !resolvedChild.startsWith(baseWithSep)) {
    throw new Error(
      `Path traversal detected: "${childPath}" escapes base directory "${baseDir}"`
    );
  }

  return resolvedChild;
}

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
 * Traverse an object path and return the value, with fallback lookup
 */
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
