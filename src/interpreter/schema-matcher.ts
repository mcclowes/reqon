import type { SchemaDefinition, FieldType, Expression } from 'vague-lang';
import type { ExecutionContext } from './context.js';
import { createContext } from './context.js';
import { evaluate } from './evaluator.js';

/**
 * Check if a value matches a schema definition.
 *
 * Matching rules:
 * - All required fields (non-optional) must be present
 * - Field types must match (string, int, decimal, boolean, date)
 * - Extra fields are allowed (open schema)
 * - Nested objects are not deeply validated (future enhancement)
 */
export function matchesSchema(
  value: unknown,
  schema: SchemaDefinition,
  schemas: Map<string, SchemaDefinition> = new Map(),
  ctx: ExecutionContext = createContext()
): boolean {
  return validateSchema(value, schema, schemas, ctx).length === 0;
}

/** Validate a value against Vague field types, ranges, assumptions, and invariants. */
export function validateSchema(
  value: unknown,
  schema: SchemaDefinition,
  schemas: Map<string, SchemaDefinition> = new Map(),
  ctx: ExecutionContext = createContext()
): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return [`Expected ${schema.name} to be an object`];
  }

  const obj = value as Record<string, unknown>;

  for (const field of schema.fields) {
    const fieldValue = obj[field.name];
    const isOptional = field.optional === true;

    // Required field must be present
    if (fieldValue === undefined) {
      if (!isOptional) {
        errors.push(`Missing required field: ${field.name}`);
      }
      continue;
    }

    // Null is allowed for optional fields
    if (fieldValue === null && isOptional) {
      continue;
    }

    if (!matchesFieldType(fieldValue, field.fieldType, schemas, ctx, obj)) {
      errors.push(`Field ${field.name} does not match ${describeFieldType(field.fieldType)}`);
    }
  }

  for (const constraint of collectConstraints(schema)) {
    if (!evaluate(constraint, ctx, obj)) {
      errors.push(`Schema constraint failed: ${JSON.stringify(constraint)}`);
    }
  }

  return errors;
}

/**
 * Check if a value matches the expected field type
 */
function matchesFieldType(
  value: unknown,
  fieldType: FieldType,
  schemas: Map<string, SchemaDefinition>,
  ctx: ExecutionContext,
  current: Record<string, unknown>
): boolean {
  if (fieldType.type === 'PrimitiveType') {
    return matchesPrimitiveType(value, fieldType.name);
  }

  if (fieldType.type === 'CollectionType') {
    if (!Array.isArray(value)) {
      return false;
    }
    const cardinality = fieldType.cardinality;
    const min = cardinality?.type === 'Cardinality' ? cardinality.min : 0;
    const max = cardinality?.type === 'Cardinality' ? cardinality.max : Number.POSITIVE_INFINITY;
    return (
      value.length >= min &&
      value.length <= max &&
      value.every((item) => matchesFieldType(item, fieldType.elementType, schemas, ctx, current))
    );
  }

  if (fieldType.type === 'ReferenceType') {
    const referenced =
      schemas.get(fieldType.path.parts.join('.')) ?? schemas.get(fieldType.path.parts.at(-1)!);
    return referenced
      ? matchesSchema(value, referenced, schemas, ctx)
      : typeof value === 'object' && value !== null;
  }

  if (fieldType.type === 'SuperpositionType') {
    return fieldType.options.some((option) => evaluate(option.value, ctx, current) === value);
  }

  // Handle generator types (faker, etc.) - can't validate statically
  if (fieldType.type === 'GeneratorType') {
    return true;
  }

  if (fieldType.type === 'ExpressionType') {
    return true;
  }

  if (fieldType.type === 'RangeType') {
    if (typeof value !== 'number') return false;
    const min = fieldType.min ? evaluate(fieldType.min, ctx, current) : undefined;
    const max = fieldType.max ? evaluate(fieldType.max, ctx, current) : undefined;
    return (typeof min !== 'number' || value >= min) && (typeof max !== 'number' || value <= max);
  }

  if (fieldType.type === 'OrderedSequenceType') {
    return Array.isArray(value);
  }

  // Unknown type - be permissive
  return true;
}

function collectConstraints(schema: SchemaDefinition): Expression[] {
  const constraints = [...(schema.constraints?.constraints ?? [])];
  for (const clause of [...(schema.assumes ?? []), ...(schema.invariants ?? [])]) {
    for (const constraint of clause.constraints) {
      constraints.push(
        clause.condition
          ? {
              type: 'LogicalExpression',
              operator: 'or',
              left: { type: 'NotExpression', operand: clause.condition },
              right: constraint,
            }
          : constraint
      );
    }
  }
  return constraints;
}

function describeFieldType(fieldType: FieldType): string {
  if (fieldType.type === 'PrimitiveType') return fieldType.name;
  if (fieldType.type === 'ReferenceType') return fieldType.path.parts.join('.');
  return fieldType.type.replace(/Type$/, '').toLowerCase();
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
    if (name === '_') {
      return '_';
    }

    const schema = schemas.get(name);
    if (!schema) {
      // Schema not found - skip
      continue;
    }

    if (matchesSchema(value, schema, schemas)) {
      return name;
    }
  }

  return undefined;
}
