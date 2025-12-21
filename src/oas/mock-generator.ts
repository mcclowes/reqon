import type { OpenAPIV3 } from 'openapi-types';

/**
 * Generate mock data from an OpenAPI schema.
 * Used for dry-run mode to produce realistic mock responses.
 */
export function generateMockData(
  schema: OpenAPIV3.SchemaObject,
  options: MockGeneratorOptions = {}
): unknown {
  const ctx: GeneratorContext = {
    depth: 0,
    maxDepth: options.maxDepth ?? 3,
    arrayLength: options.arrayLength ?? 2,
    seenRefs: new Set(),
  };

  return generateValue(schema, ctx);
}

export interface MockGeneratorOptions {
  /** Maximum depth for nested objects (default: 3) */
  maxDepth?: number;
  /** Number of items to generate for arrays (default: 2) */
  arrayLength?: number;
}

interface GeneratorContext {
  depth: number;
  maxDepth: number;
  arrayLength: number;
  seenRefs: Set<string>;
}

function generateValue(schema: OpenAPIV3.SchemaObject, ctx: GeneratorContext): unknown {
  // Handle nullable
  if (schema.nullable && ctx.depth > 0) {
    // Return null occasionally for nullable fields at depth > 0
    return null;
  }

  // Handle enum - pick first value
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // Handle example if provided
  if (schema.example !== undefined) {
    return schema.example;
  }

  // Handle default if provided
  if (schema.default !== undefined) {
    return schema.default;
  }

  // Check for allOf/oneOf/anyOf
  if (schema.allOf && schema.allOf.length > 0) {
    // Merge all schemas
    const merged: Record<string, unknown> = {};
    for (const subSchema of schema.allOf) {
      const subValue = generateValue(subSchema as OpenAPIV3.SchemaObject, ctx);
      if (typeof subValue === 'object' && subValue !== null) {
        Object.assign(merged, subValue);
      }
    }
    return merged;
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    return generateValue(schema.oneOf[0] as OpenAPIV3.SchemaObject, ctx);
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    return generateValue(schema.anyOf[0] as OpenAPIV3.SchemaObject, ctx);
  }

  // Generate based on type
  switch (schema.type) {
    case 'string':
      return generateString(schema);
    case 'number':
      return generateNumber(schema);
    case 'integer':
      return generateInteger(schema);
    case 'boolean':
      return true;
    case 'array':
      return generateArray(schema as OpenAPIV3.ArraySchemaObject, ctx);
    case 'object':
      return generateObject(schema, ctx);
    default: {
      // No type specified - try to infer from properties
      // Cast to SchemaObject to access properties on untyped schemas
      const untyped = schema as OpenAPIV3.SchemaObject;
      if (untyped.properties) {
        return generateObject(untyped, ctx);
      }
      // Return empty object as fallback
      return {};
    }
  }
}

function generateString(schema: OpenAPIV3.SchemaObject): string {
  // Handle format
  switch (schema.format) {
    case 'date':
      return '2024-01-15';
    case 'date-time':
      return '2024-01-15T10:30:00Z';
    case 'email':
      return 'user@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'uuid':
      return '550e8400-e29b-41d4-a716-446655440000';
    case 'hostname':
      return 'example.com';
    case 'ipv4':
      return '192.168.1.1';
    case 'ipv6':
      return '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    case 'byte':
      return 'SGVsbG8gV29ybGQ='; // Base64 encoded "Hello World"
    case 'binary':
      return '<binary>';
    case 'password':
      return '********';
    case 'phone':
      return '+1-555-555-5555';
  }

  // Respect minLength/maxLength
  const minLen = schema.minLength ?? 0;
  const maxLen = schema.maxLength ?? 50;
  const targetLen = Math.max(minLen, Math.min(8, maxLen));

  // Generate a simple mock string
  const base = 'mock_value';
  if (base.length >= targetLen) {
    return base.substring(0, targetLen);
  }
  return base.padEnd(targetLen, '_');
}

function generateNumber(schema: OpenAPIV3.SchemaObject): number {
  const min = schema.minimum ?? 0;
  const max = schema.maximum ?? 100;

  // Generate a value in range
  const value = min + (max - min) / 2;

  // Handle multipleOf
  if (schema.multipleOf) {
    return Math.round(value / schema.multipleOf) * schema.multipleOf;
  }

  return Math.round(value * 100) / 100;
}

function generateInteger(schema: OpenAPIV3.SchemaObject): number {
  const min = schema.minimum ?? 0;
  const max = schema.maximum ?? 100;

  // Generate integer in range
  const value = Math.floor(min + (max - min) / 2);

  // Handle multipleOf
  if (schema.multipleOf) {
    return Math.round(value / schema.multipleOf) * schema.multipleOf;
  }

  return value;
}

function generateArray(schema: OpenAPIV3.ArraySchemaObject, ctx: GeneratorContext): unknown[] {
  // Check depth limit
  if (ctx.depth >= ctx.maxDepth) {
    return [];
  }

  // Determine array length
  const minItems = schema.minItems ?? 0;
  const maxItems = schema.maxItems ?? ctx.arrayLength;
  const length = Math.max(minItems, Math.min(ctx.arrayLength, maxItems));

  if (!schema.items) {
    return Array(length).fill({});
  }

  const itemSchema = schema.items as OpenAPIV3.SchemaObject;
  const items: unknown[] = [];

  for (let i = 0; i < length; i++) {
    items.push(
      generateValue(itemSchema, {
        ...ctx,
        depth: ctx.depth + 1,
      })
    );
  }

  return items;
}

function generateObject(
  schema: OpenAPIV3.SchemaObject,
  ctx: GeneratorContext
): Record<string, unknown> {
  // Check depth limit
  if (ctx.depth >= ctx.maxDepth) {
    return {};
  }

  const result: Record<string, unknown> = {};
  const properties = schema.properties as Record<string, OpenAPIV3.SchemaObject> | undefined;

  if (!properties) {
    return result;
  }

  // Include all properties at any depth to generate complete mock data
  for (const [key, propSchema] of Object.entries(properties)) {
    result[key] = generateValue(propSchema, {
      ...ctx,
      depth: ctx.depth + 1,
    });
  }

  return result;
}
