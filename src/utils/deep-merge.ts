/**
 * Deep-merge for store upserts.
 *
 * A shallow `{ ...existing, ...incoming }` clobbers nested objects: merging
 * `{ profile: { city: 'LA' } }` over `{ profile: { name: 'Alice' } }` drops
 * `name`. deepMerge recurses into plain objects so sibling nested fields
 * survive. Arrays and primitives are replaced wholesale (the incoming value
 * wins), and neither input is mutated.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = Object.prototype.hasOwnProperty.call(out, key) ? out[key] : undefined;
    const merged =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
    // A literal "__proto__" data key (e.g. from JSON.parse) must be stored as an
    // own property. Plain `out[key] = merged` would hit the prototype setter,
    // dropping the field and mangling out's prototype chain.
    if (key === '__proto__') {
      Object.defineProperty(out, key, {
        value: merged,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      out[key] = merged;
    }
  }
  return out;
}
