/**
 * Utility functions for path traversal and value extraction
 */

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
