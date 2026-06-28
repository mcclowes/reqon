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
});
