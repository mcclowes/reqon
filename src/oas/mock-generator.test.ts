import { describe, it, expect } from 'vitest';
import { generateMockData } from './mock-generator.js';
import type { OpenAPIV3 } from 'openapi-types';

describe('generateMockData', () => {
  describe('string type', () => {
    it('generates basic string', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string' };
      const result = generateMockData(schema);
      expect(typeof result).toBe('string');
    });

    it('generates date format', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', format: 'date' };
      const result = generateMockData(schema);
      expect(result).toBe('2024-01-15');
    });

    it('generates date-time format', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', format: 'date-time' };
      const result = generateMockData(schema);
      expect(result).toBe('2024-01-15T10:30:00Z');
    });

    it('generates email format', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', format: 'email' };
      const result = generateMockData(schema);
      expect(result).toBe('user@example.com');
    });

    it('generates uri format', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', format: 'uri' };
      const result = generateMockData(schema);
      expect(result).toBe('https://example.com');
    });

    it('generates uuid format', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', format: 'uuid' };
      const result = generateMockData(schema);
      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('uses example when provided', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', example: 'custom value' };
      const result = generateMockData(schema);
      expect(result).toBe('custom value');
    });

    it('uses default when provided', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', default: 'default value' };
      const result = generateMockData(schema);
      expect(result).toBe('default value');
    });

    it('uses enum first value', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'string', enum: ['active', 'inactive', 'pending'] };
      const result = generateMockData(schema);
      expect(result).toBe('active');
    });
  });

  describe('number type', () => {
    it('generates number', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'number' };
      const result = generateMockData(schema);
      expect(typeof result).toBe('number');
    });

    it('respects minimum and maximum', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'number', minimum: 10, maximum: 20 };
      const result = generateMockData(schema) as number;
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(20);
    });
  });

  describe('integer type', () => {
    it('generates integer', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'integer' };
      const result = generateMockData(schema);
      expect(typeof result).toBe('number');
      expect(Number.isInteger(result)).toBe(true);
    });

    it('respects minimum and maximum', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'integer', minimum: 5, maximum: 15 };
      const result = generateMockData(schema) as number;
      expect(result).toBeGreaterThanOrEqual(5);
      expect(result).toBeLessThanOrEqual(15);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('boolean type', () => {
    it('generates boolean', () => {
      const schema: OpenAPIV3.SchemaObject = { type: 'boolean' };
      const result = generateMockData(schema);
      expect(result).toBe(true);
    });
  });

  describe('array type', () => {
    it('generates array with items', () => {
      const schema: OpenAPIV3.ArraySchemaObject = {
        type: 'array',
        items: { type: 'string' },
      };
      const result = generateMockData(schema);
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(2); // default arrayLength
    });

    it('respects minItems', () => {
      const schema: OpenAPIV3.ArraySchemaObject = {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
      };
      const result = generateMockData(schema);
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBeGreaterThanOrEqual(3);
    });

    it('respects custom arrayLength option', () => {
      const schema: OpenAPIV3.ArraySchemaObject = {
        type: 'array',
        items: { type: 'number' },
      };
      const result = generateMockData(schema, { arrayLength: 5 });
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(5);
    });
  });

  describe('object type', () => {
    it('generates object with properties', () => {
      const schema: OpenAPIV3.SchemaObject = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          active: { type: 'boolean' },
        },
        required: ['id', 'name'],
      };
      const result = generateMockData(schema) as Record<string, unknown>;

      expect(typeof result).toBe('object');
      expect(typeof result.id).toBe('number');
      expect(typeof result.name).toBe('string');
      expect(result.active).toBe(true);
    });

    it('generates nested objects', () => {
      const schema: OpenAPIV3.SchemaObject = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      };
      const result = generateMockData(schema) as Record<string, unknown>;

      expect(typeof result.user).toBe('object');
      const user = result.user as Record<string, unknown>;
      expect(typeof user.id).toBe('number');
      expect(user.email).toBe('user@example.com');
    });

    it('respects maxDepth option', () => {
      const schema: OpenAPIV3.SchemaObject = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                properties: {
                  level3: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const result = generateMockData(schema, { maxDepth: 2 }) as Record<string, unknown>;
      expect(typeof result.level1).toBe('object');
      const level1 = result.level1 as Record<string, unknown>;
      // At depth 2, level2 should be an empty object
      expect(level1.level2).toEqual({});
    });
  });

  describe('composition schemas', () => {
    it('handles allOf by merging schemas', () => {
      const schema: OpenAPIV3.SchemaObject = {
        allOf: [
          {
            type: 'object',
            properties: { id: { type: 'integer' } },
          },
          {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        ],
      };
      const result = generateMockData(schema) as Record<string, unknown>;

      expect(typeof result.id).toBe('number');
      expect(typeof result.name).toBe('string');
    });

    it('handles oneOf by using first schema', () => {
      const schema: OpenAPIV3.SchemaObject = {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
        ],
      };
      const result = generateMockData(schema);
      expect(typeof result).toBe('string');
    });

    it('handles anyOf by using first schema', () => {
      const schema: OpenAPIV3.SchemaObject = {
        anyOf: [
          { type: 'boolean' },
          { type: 'string' },
        ],
      };
      const result = generateMockData(schema);
      expect(result).toBe(true);
    });
  });

  describe('realistic API response schema', () => {
    it('generates mock for typical user list response', () => {
      const schema: OpenAPIV3.SchemaObject = {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                name: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
                status: { type: 'string', enum: ['active', 'inactive'] },
              },
              required: ['id', 'email', 'name'],
            },
          },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer', minimum: 1 },
              perPage: { type: 'integer', minimum: 1, maximum: 100 },
              total: { type: 'integer' },
            },
          },
        },
      };

      const result = generateMockData(schema) as Record<string, unknown>;

      expect(Array.isArray(result.data)).toBe(true);
      const data = result.data as Record<string, unknown>[];
      expect(data.length).toBe(2);

      const firstUser = data[0];
      expect(firstUser.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(firstUser.email).toBe('user@example.com');
      expect(firstUser.status).toBe('active');

      expect(typeof result.pagination).toBe('object');
      const pagination = result.pagination as Record<string, unknown>;
      expect(typeof pagination.page).toBe('number');
    });
  });
});
