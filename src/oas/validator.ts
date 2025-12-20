import type { OpenAPIV3 } from 'openapi-types';

type ArraySchemaObject = OpenAPIV3.ArraySchemaObject;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export function validateResponse(
  data: unknown,
  schema: OpenAPIV3.SchemaObject,
  path = ''
): ValidationResult {
  const errors: ValidationError[] = [];

  validateValue(data, schema, path, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateValue(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  path: string,
  errors: ValidationError[]
): void {
  // Handle nullable
  if (value === null) {
    if (schema.nullable) return;
    errors.push({ path, message: 'Value is null but schema is not nullable' });
    return;
  }

  // Handle undefined/missing
  if (value === undefined) {
    // Required check happens at object level
    return;
  }

  // Check type
  const schemaType = schema.type;

  switch (schemaType) {
    case 'string':
      validateString(value, schema, path, errors);
      break;
    case 'number':
    case 'integer':
      validateNumber(value, schema, path, errors);
      break;
    case 'boolean':
      validateBoolean(value, path, errors);
      break;
    case 'array':
      validateArray(value, schema, path, errors);
      break;
    case 'object':
      validateObject(value, schema, path, errors);
      break;
    default:
      // No type specified, or unknown type - allow anything
      break;
  }

  // Check enum
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      path,
      message: `Value not in enum`,
      expected: schema.enum.join(' | '),
      actual: String(value),
    });
  }
}

function validateString(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  path: string,
  errors: ValidationError[]
): void {
  if (typeof value !== 'string') {
    errors.push({
      path,
      message: 'Expected string',
      expected: 'string',
      actual: typeof value,
    });
    return;
  }

  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      path,
      message: `String too short`,
      expected: `>= ${schema.minLength} chars`,
      actual: `${value.length} chars`,
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      path,
      message: `String too long`,
      expected: `<= ${schema.maxLength} chars`,
      actual: `${value.length} chars`,
    });
  }

  if (schema.pattern) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(value)) {
      errors.push({
        path,
        message: `String does not match pattern`,
        expected: schema.pattern,
        actual: value,
      });
    }
  }
}

function validateNumber(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  path: string,
  errors: ValidationError[]
): void {
  if (typeof value !== 'number') {
    errors.push({
      path,
      message: 'Expected number',
      expected: schema.type ?? 'number',
      actual: typeof value,
    });
    return;
  }

  if (schema.type === 'integer' && !Number.isInteger(value)) {
    errors.push({
      path,
      message: 'Expected integer',
      expected: 'integer',
      actual: String(value),
    });
  }

  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({
      path,
      message: `Number below minimum`,
      expected: `>= ${schema.minimum}`,
      actual: String(value),
    });
  }

  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({
      path,
      message: `Number above maximum`,
      expected: `<= ${schema.maximum}`,
      actual: String(value),
    });
  }
}

function validateBoolean(
  value: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (typeof value !== 'boolean') {
    errors.push({
      path,
      message: 'Expected boolean',
      expected: 'boolean',
      actual: typeof value,
    });
  }
}

function validateArray(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  path: string,
  errors: ValidationError[]
): void {
  if (!Array.isArray(value)) {
    errors.push({
      path,
      message: 'Expected array',
      expected: 'array',
      actual: typeof value,
    });
    return;
  }

  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({
      path,
      message: `Array too short`,
      expected: `>= ${schema.minItems} items`,
      actual: `${value.length} items`,
    });
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({
      path,
      message: `Array too long`,
      expected: `<= ${schema.maxItems} items`,
      actual: `${value.length} items`,
    });
  }

  // Validate items
  const arraySchema = schema as OpenAPIV3.ArraySchemaObject;
  if (arraySchema.items) {
    const itemSchema = arraySchema.items as OpenAPIV3.SchemaObject;
    value.forEach((item, index) => {
      validateValue(item, itemSchema, `${path}[${index}]`, errors);
    });
  }
}

function validateObject(
  value: unknown,
  schema: OpenAPIV3.SchemaObject,
  path: string,
  errors: ValidationError[]
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({
      path,
      message: 'Expected object',
      expected: 'object',
      actual: Array.isArray(value) ? 'array' : typeof value,
    });
    return;
  }

  const obj = value as Record<string, unknown>;

  // Check required properties
  if (schema.required) {
    for (const prop of schema.required) {
      if (!(prop in obj)) {
        errors.push({
          path: path ? `${path}.${prop}` : prop,
          message: `Missing required property`,
        });
      }
    }
  }

  // Validate properties
  const properties = schema.properties as Record<string, OpenAPIV3.SchemaObject> | undefined;
  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj) {
        const propPath = path ? `${path}.${key}` : key;
        validateValue(obj[key], propSchema, propPath, errors);
      }
    }
  }

  // Handle additionalProperties
  if (schema.additionalProperties === false) {
    const allowedKeys = new Set(Object.keys(properties ?? {}));
    for (const key of Object.keys(obj)) {
      if (!allowedKeys.has(key)) {
        errors.push({
          path: path ? `${path}.${key}` : key,
          message: `Unexpected property`,
        });
      }
    }
  } else if (typeof schema.additionalProperties === 'object') {
    const additionalSchema = schema.additionalProperties as OpenAPIV3.SchemaObject;
    const allowedKeys = new Set(Object.keys(properties ?? {}));
    for (const [key, val] of Object.entries(obj)) {
      if (!allowedKeys.has(key)) {
        const propPath = path ? `${path}.${key}` : key;
        validateValue(val, additionalSchema, propPath, errors);
      }
    }
  }
}
