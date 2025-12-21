/**
 * Type guard utilities to reduce type assertions and improve type safety.
 * These guards provide runtime type checking with TypeScript type narrowing.
 */

/**
 * Type guard to check if a value is a non-null object (excluding arrays).
 * Narrows the type to Record<string, unknown> for safe property access.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard to check if a value is a non-null object (including arrays).
 * Useful when you need to access properties on any object-like value.
 */
export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/**
 * Type guard to check if a value is an array of a specific type.
 * Performs runtime check on each element using the provided guard.
 */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

/**
 * Type guard to check if a value is a string.
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a number.
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

/**
 * Type guard to check if a value is a boolean.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Type guard to check if a value is defined (not undefined).
 */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Type guard to check if a value is not null or undefined.
 */
export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Safely access a property on an unknown value.
 * Returns undefined if the value is not an object or the property doesn't exist.
 */
export function getProperty(value: unknown, key: string): unknown {
  if (isRecord(value)) {
    return value[key];
  }
  return undefined;
}

/**
 * Safely access a nested property path on an unknown value.
 * Returns undefined if any part of the path is not an object.
 */
export function getNestedProperty(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Check if an object has a specific property.
 * Narrows the type to include that property.
 */
export function hasProperty<K extends string>(
  value: unknown,
  key: K
): value is Record<K, unknown> {
  return isRecord(value) && key in value;
}

/**
 * Check if an object has a specific property with a specific type.
 */
export function hasTypedProperty<K extends string, T>(
  value: unknown,
  key: K,
  guard: (v: unknown) => v is T
): value is Record<K, T> {
  return hasProperty(value, key) && guard(value[key]);
}
