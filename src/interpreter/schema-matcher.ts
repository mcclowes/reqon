import type { SchemaDefinition, FieldDefinition, FieldType } from 'vague-lang';

/**
 * Check if a value matches a schema definition.
 *
 * Matching rules:
 * - All required fields (non-optional) must be present
 * - Field types must match (string, int, decimal, boolean, date)
 * - Extra fields are allowed (open schema)
 * - Nested objects are not deeply validated (future enhancement)
 */
export function matchesSchema(value: unknown, schema: SchemaDefinition): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  for (const field of schema.fields) {
    const fieldValue = obj[field.name];
    const isOptional = field.optional === true;

    // Required field must be present
    if (fieldValue === undefined) {
      if (!isOptional) {
        return false;
      }
      continue;
    }

    // Null is allowed for optional fields
    if (fieldValue === null && isOptional) {
      continue;
    }

    // Check type if present
    if (!matchesFieldType(fieldValue, field.fieldType)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a value matches the expected field type
 */
function matchesFieldType(value: unknown, fieldType: FieldType): boolean {
  // Handle primitive types
  if (fieldType.type === 'PrimitiveType') {
    return matchesPrimitiveType(value, fieldType.name);
  }

  // Handle collection types (arrays)
  if (fieldType.type === 'CollectionType') {
    if (!Array.isArray(value)) {
      return false;
    }
    // For now, don't validate element types
    return true;
  }

  // Handle object/reference types
  if (fieldType.type === 'ReferenceType') {
    // For now, just check it's an object
    return typeof value === 'object' && value !== null;
  }

  // Handle superposition types (unions) - any option matching is ok
  if (fieldType.type === 'SuperpositionType') {
    // Would need to check each option - be permissive for now
    return true;
  }

  // Handle generator types (faker, etc.) - can't validate statically
  if (fieldType.type === 'GeneratorType') {
    return true;
  }

  // Handle expression types - can't validate statically
  if (fieldType.type === 'ExpressionType') {
    return true;
  }

  // Handle range types - check it's a number in range
  if (fieldType.type === 'RangeType') {
    return typeof value === 'number';
  }

  // Handle ordered sequence types (tuples)
  if (fieldType.type === 'OrderedSequenceType') {
    return Array.isArray(value);
  }

  // Unknown type - be permissive
  return true;
}

/**
 * Check if a value matches a primitive type
 */
function matchesPrimitiveType(value: unknown, typeName: string): boolean {

  switch (typeName) {
    case 'string':
      return typeof value === 'string';

    case 'int':
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);

    case 'decimal':
    case 'number':
    case 'float':
    case 'double':
      return typeof value === 'number';

    case 'boolean':
    case 'bool':
      return typeof value === 'boolean';

    case 'date':
    case 'datetime':
      // Accept strings (ISO format) or Date objects
      if (value instanceof Date) return true;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return !isNaN(parsed);
      }
      return false;

    case 'any':
      return true;

    default:
      // Unknown primitive - be permissive
      return true;
  }
}

/**
 * Find the first matching schema from a list.
 * Returns the schema name or undefined if no match.
 */
export function findMatchingSchema(
  value: unknown,
  schemas: Map<string, SchemaDefinition>,
  schemaNames: string[]
): string | undefined {
  for (const name of schemaNames) {
    // Handle wildcard
    if (name === '_') {
      return '_';
    }

    const schema = schemas.get(name);
    if (!schema) {
      // Schema not found - skip
      continue;
    }

    if (matchesSchema(value, schema)) {
      return name;
    }
  }

  return undefined;
}
