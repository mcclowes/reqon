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
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}
