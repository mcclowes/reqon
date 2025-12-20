# Property-Based Testing Skill

Use this skill when implementing property-based tests, fuzzing the parser, or generating mock API responses.

## Capabilities

### Generating Fuzzing Inputs for the Parser
- Generate random valid Reqon programs
- Generate edge-case inputs (empty strings, unicode, deeply nested)
- Generate semi-valid inputs to test error recovery
- Mutate valid programs to find parser bugs

### Writing Vitest Property-Based Tests
- Use fast-check or similar libraries
- Define properties that should hold for all inputs
- Shrink failing cases to minimal reproductions
- Combine with traditional example-based tests

### Creating Mock API Responses
- Generate responses matching Reqon schemas
- Create varied test data (edge cases, nulls, arrays)
- Simulate pagination responses
- Mock error responses (4xx, 5xx)

## Context Files
When using this skill, read:
- `src/parser/parser.test.ts` - Existing parser tests
- `src/integration.test.ts` - Integration test patterns
- `src/ast/nodes.ts` - AST structure for generation
- `src/lexer/tokens.ts` - Valid tokens for fuzzing

## Implementation Patterns

### Property-Based Test Setup
```typescript
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parse } from './parser';
import { lex } from '../lexer';

describe('Parser Properties', () => {
  it('should parse any valid mission without throwing', () => {
    fc.assert(
      fc.property(validMissionArb, (mission) => {
        expect(() => parse(lex(mission))).not.toThrow();
      })
    );
  });
});
```

### Arbitrary Generators for Reqon

```typescript
// Generate valid identifiers
const identifierArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'),
  { minLength: 1, maxLength: 20 }
).filter(s => /^[a-z_][a-z0-9_]*$/i.test(s));

// Generate valid string literals
const stringLiteralArb = fc.string().map(s => `"${s.replace(/"/g, '\\"')}"`);

// Generate valid fetch paths
const pathArb = fc.array(identifierArb, { minLength: 1, maxLength: 5 })
  .map(parts => '/' + parts.join('/'));

// Generate valid actions
const actionArb = fc.record({
  name: identifierArb,
  path: pathArb,
}).map(({ name, path }) => `action ${name} { fetch ${path} }`);

// Generate valid missions
const validMissionArb = fc.record({
  name: identifierArb,
  url: fc.webUrl(),
  actions: fc.array(actionArb, { minLength: 1, maxLength: 5 }),
}).map(({ name, url, actions }) => `
  mission ${name} {
    source api { url: "${url}" }
    ${actions.join('\n')}
  }
`);
```

### Mock Response Generation
```typescript
// Generate mock response matching schema
const mockResponseArb = (schema: SchemaNode): fc.Arbitrary<unknown> => {
  switch (schema.type) {
    case 'string': return fc.string();
    case 'number': return fc.double();
    case 'boolean': return fc.boolean();
    case 'array': return fc.array(mockResponseArb(schema.items));
    case 'object': return fc.record(
      Object.fromEntries(
        Object.entries(schema.properties).map(
          ([k, v]) => [k, mockResponseArb(v)]
        )
      )
    );
  }
};

// Generate paginated response
const paginatedResponseArb = <T>(itemArb: fc.Arbitrary<T>) =>
  fc.record({
    items: fc.array(itemArb, { minLength: 0, maxLength: 100 }),
    next_cursor: fc.option(fc.hexaString({ minLength: 16, maxLength: 16 })),
    total: fc.nat(),
  });
```

### Parser Fuzzing Strategies
```typescript
// Mutation-based fuzzing
const mutateProgram = (valid: string): fc.Arbitrary<string> =>
  fc.oneof(
    // Delete random character
    fc.nat({ max: valid.length - 1 }).map(i =>
      valid.slice(0, i) + valid.slice(i + 1)
    ),
    // Insert random character
    fc.tuple(fc.nat({ max: valid.length }), fc.char()).map(([i, c]) =>
      valid.slice(0, i) + c + valid.slice(i)
    ),
    // Replace random character
    fc.tuple(fc.nat({ max: valid.length - 1 }), fc.char()).map(([i, c]) =>
      valid.slice(0, i) + c + valid.slice(i + 1)
    )
  );
```

## Dependencies
Add to `package.json`:
```json
{
  "devDependencies": {
    "fast-check": "^3.15.0"
  }
}
```
