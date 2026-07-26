import { describe, it, expect } from 'vitest';
import { deepMerge } from './deep-merge.js';

describe('deepMerge', () => {
  it('merges nested objects without clobbering sibling keys', () => {
    const out = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } });
    expect(out).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  it('replaces arrays rather than concatenating', () => {
    expect(deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] })).toEqual({ tags: ['c'] });
  });

  it('lets the source override primitives and add keys', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('does not mutate either input', () => {
    const target = { a: { x: 1 } };
    const source = { a: { y: 2 } };
    deepMerge(target, source);
    expect(target).toEqual({ a: { x: 1 } });
    expect(source).toEqual({ a: { y: 2 } });
  });

  it('replaces a primitive with an object and vice versa', () => {
    expect(deepMerge({ a: 1 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    expect(deepMerge({ a: { x: 1 } }, { a: 5 })).toEqual({ a: 5 });
  });

  it('preserves a literal "__proto__" data key without mangling the prototype', () => {
    // JSON.parse yields an own enumerable "__proto__" property; a plain
    // out[key] = value assignment would hit the prototype setter and drop it.
    const source = JSON.parse('{"__proto__": {"role": "admin"}, "id": 1}');
    const out = deepMerge({ id: 0 }, source);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ role: 'admin' });
    expect(out.id).toBe(1);
    // The merged object's prototype chain is untouched (no pollution).
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    const bare: Record<string, unknown> = {};
    expect(bare.role).toBeUndefined();
  });
});
