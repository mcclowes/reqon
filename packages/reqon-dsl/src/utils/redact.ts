/**
 * Secret redaction for logs, error messages, and durable trace files.
 *
 * Uses a denylist of sensitive key-name patterns: any object property whose
 * key looks like a credential is replaced with {@link REDACTED}. This is a
 * best-effort guard — it cannot catch a raw secret stored under an innocuous
 * key — so callers should also avoid persisting cleartext credentials.
 */

export const REDACTED = '[REDACTED]';

/**
 * Key names that should never have their value logged or persisted in clear.
 * Tested against a snake_cased form of the key, so short names like `otp` and
 * `pin` can demand segment boundaries (matching `user_pin` and `otpCode` but
 * not `spinner`), and `session` can exclude the innocuous `session_count`.
 */
const SENSITIVE_KEY =
  /(pass(word|wd)?|secret|token|auth(orization)?|api[-_]?key|access[-_]?key|client[-_]?secret|credential|cookie|session(?![-_]?count)|bearer|private[-_]?key|jwt|signature|(^|[-_])(otp|pin)(?=[-_]|$))/i;

/** True when a key name looks like it holds a credential. */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return SENSITIVE_KEY.test(normalized);
}

/**
 * Value-like built-ins that keep their state in internal slots rather than
 * enumerable properties. Recursing into them with Object.entries destroys
 * them — a Date becomes `{}` — corrupting every timestamp in every trace
 * snapshot and structured log that passes through redaction (#263). None can
 * hold keyed secrets, so they pass through unchanged.
 */
function hasInternalSlots(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

/**
 * Return a deep copy of `value` with any credential-looking properties
 * replaced by {@link REDACTED}. Non-objects are returned unchanged. Cycles are
 * handled, and the input is never mutated.
 */
export function redactSecrets<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (value === null || typeof value !== 'object') return value;
  if (hasInternalSlots(value as object)) return value;

  // Return the redacted copy already made for this object, not the original.
  // Using a WeakMap (rather than a WeakSet) means a shared or cyclic reference
  // resolves to its redacted clone instead of leaking the cleartext input.
  const cached = seen.get(value as object);
  if (cached !== undefined) return cached as T;

  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    seen.set(value as object, arr); // register before recursing so cycles resolve
    for (const item of value) arr.push(redactSecrets(item, seen));
    return arr as unknown as T;
  }

  if (value instanceof Map) {
    const map = new Map<unknown, unknown>();
    seen.set(value as object, map);
    for (const [key, val] of value) {
      map.set(
        key,
        typeof key === 'string' && isSensitiveKey(key) ? REDACTED : redactSecrets(val, seen)
      );
    }
    return map as unknown as T;
  }

  if (value instanceof Set) {
    const set = new Set<unknown>();
    seen.set(value as object, set);
    for (const item of value) set.add(redactSecrets(item, seen));
    return set as unknown as T;
  }

  const out: Record<string, unknown> = {};
  seen.set(value as object, out); // register before recursing so cycles resolve
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

/**
 * Scrub credential-looking values out of free text: error messages, response
 * body snippets, URLs. Key-based object redaction cannot reach a secret
 * already flattened into a string, so boundaries that persist or serve text
 * apply this instead (#263). Covers JSON pairs (`"api_key": "…"`),
 * query/form pairs (`api_key=…`), and bearer credentials (`Bearer eyJ…`).
 */
export function redactText(text: string): string {
  return text
    .replace(/"([^"\n]{1,64})"\s*:\s*"(?:[^"\\]|\\.)*"/g, (match, key: string) =>
      isSensitiveKey(key) ? `"${key}":"${REDACTED}"` : match
    )
    .replace(/([A-Za-z0-9_.-]{1,64})=([^&\s"'`]+)/g, (match, key: string) =>
      isSensitiveKey(key) ? `${key}=${REDACTED}` : match
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`);
}
