/**
 * Secret redaction for logs, error messages, and durable trace files.
 *
 * Uses a denylist of sensitive key-name patterns: any object property whose
 * key looks like a credential is replaced with {@link REDACTED}. This is a
 * best-effort guard — it cannot catch a raw secret stored under an innocuous
 * key — so callers should also avoid persisting cleartext credentials.
 */

export const REDACTED = '[REDACTED]';

/** Key names that should never have their value logged or persisted in clear. */
const SENSITIVE_KEY =
  /(pass(word|wd)?|secret|token|auth(orization)?|api[-_]?key|access[-_]?key|client[-_]?secret|credential|cookie|session|bearer|private[-_]?key)/i;

/** True when a key name looks like it holds a credential. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Return a deep copy of `value` with any credential-looking properties
 * replaced by {@link REDACTED}. Non-objects are returned unchanged. Cycles are
 * handled, and the input is never mutated.
 */
export function redactSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactSecrets(val, seen);
  }
  return out as T;
}

/**
 * Redact a named value for logging: if the name itself looks sensitive the
 * whole value is hidden; otherwise nested credential properties are redacted.
 */
export function redactNamedValue(name: string, value: unknown): unknown {
  return isSensitiveKey(name) ? REDACTED : redactSecrets(value);
}
