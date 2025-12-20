import { describe, it, expect } from 'vitest';
import { matchesSchema, findMatchingSchema } from './schema-matcher.js';
import type { SchemaDefinition } from 'vague-lang';

describe('Schema Matcher', () => {
  describe('matchesSchema', () => {
    const userSchema: SchemaDefinition = {
      type: 'SchemaDefinition',
      name: 'User',
      fields: [
        {
          type: 'FieldDefinition',
          name: 'id',
          fieldType: { type: 'PrimitiveType', name: 'int' },
        },
        {
          type: 'FieldDefinition',
          name: 'name',
          fieldType: { type: 'PrimitiveType', name: 'string' },
        },
        {
          type: 'FieldDefinition',
          name: 'email',
          fieldType: { type: 'PrimitiveType', name: 'string' },
          optional: true,
        },
      ],
    };

    it('matches valid object with all required fields', () => {
      const value = { id: 1, name: 'Alice' };
      expect(matchesSchema(value, userSchema)).toBe(true);
    });

    it('matches valid object with optional field', () => {
      const value = { id: 1, name: 'Alice', email: 'alice@example.com' };
      expect(matchesSchema(value, userSchema)).toBe(true);
    });

    it('matches object with extra fields (open schema)', () => {
      const value = { id: 1, name: 'Alice', extra: 'ignored' };
      expect(matchesSchema(value, userSchema)).toBe(true);
    });

    it('rejects object missing required field', () => {
      const value = { id: 1 }; // missing 'name'
      expect(matchesSchema(value, userSchema)).toBe(false);
    });

    it('rejects wrong type for field', () => {
      const value = { id: 'not-a-number', name: 'Alice' };
      expect(matchesSchema(value, userSchema)).toBe(false);
    });

    it('rejects null value', () => {
      expect(matchesSchema(null, userSchema)).toBe(false);
    });

    it('rejects primitive value', () => {
      expect(matchesSchema('string', userSchema)).toBe(false);
    });

    it('allows null for optional fields', () => {
      const value = { id: 1, name: 'Alice', email: null };
      expect(matchesSchema(value, userSchema)).toBe(true);
    });
  });

  describe('findMatchingSchema', () => {
    const successSchema: SchemaDefinition = {
      type: 'SchemaDefinition',
      name: 'SuccessResponse',
      fields: [
        {
          type: 'FieldDefinition',
          name: 'data',
          fieldType: { type: 'ReferenceType', name: 'object' },
        },
        {
          type: 'FieldDefinition',
          name: 'status',
          fieldType: { type: 'PrimitiveType', name: 'string' },
        },
      ],
    };

    const errorSchema: SchemaDefinition = {
      type: 'SchemaDefinition',
      name: 'ErrorResponse',
      fields: [
        {
          type: 'FieldDefinition',
          name: 'error',
          fieldType: { type: 'PrimitiveType', name: 'string' },
        },
        {
          type: 'FieldDefinition',
          name: 'code',
          fieldType: { type: 'PrimitiveType', name: 'int' },
        },
      ],
    };

    const schemas = new Map<string, SchemaDefinition>([
      ['SuccessResponse', successSchema],
      ['ErrorResponse', errorSchema],
    ]);

    it('finds matching schema in order', () => {
      const successValue = { data: { id: 1 }, status: 'ok' };
      const result = findMatchingSchema(
        successValue,
        schemas,
        ['SuccessResponse', 'ErrorResponse']
      );
      expect(result).toBe('SuccessResponse');
    });

    it('finds second schema if first does not match', () => {
      const errorValue = { error: 'Not found', code: 404 };
      const result = findMatchingSchema(
        errorValue,
        schemas,
        ['SuccessResponse', 'ErrorResponse']
      );
      expect(result).toBe('ErrorResponse');
    });

    it('returns undefined if no schema matches', () => {
      const value = { random: 'value' };
      const result = findMatchingSchema(
        value,
        schemas,
        ['SuccessResponse', 'ErrorResponse']
      );
      expect(result).toBeUndefined();
    });

    it('handles wildcard pattern', () => {
      const value = { random: 'value' };
      const result = findMatchingSchema(
        value,
        schemas,
        ['SuccessResponse', 'ErrorResponse', '_']
      );
      expect(result).toBe('_');
    });

    it('respects schema order (first match wins)', () => {
      // Create a schema that matches both
      const ambiguousValue = { data: {}, status: 'ok', error: 'msg', code: 500 };
      const result = findMatchingSchema(
        ambiguousValue,
        schemas,
        ['SuccessResponse', 'ErrorResponse']
      );
      expect(result).toBe('SuccessResponse'); // First match wins
    });
  });
});
