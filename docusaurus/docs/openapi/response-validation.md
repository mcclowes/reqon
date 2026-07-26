---
sidebar_position: 4
---

# Response validation

When a source is backed by an OpenAPI spec, Reqon can check responses against the operation's schema.

## Enabling validation

Set `validateResponses: true` on the source:

```vague
source API from "./spec.yaml" {
  auth: bearer,
  validateResponses: true
}
```

## What gets validated

Validation runs only for `call Source.operationId` requests, against the operation's `200` JSON response schema. Plain `get`/`post` fetches are not validated, and neither are non-200 responses.

```vague
call API.getPetById
// If API has validateResponses: true and getPetById defines a 200 schema,
// the response body is checked against that schema.
```

## Behaviour

Validation is advisory. When a response doesn't match the schema, Reqon logs warnings (visible with `--verbose`) and execution continues. It does not throw, abort, or change `response`, and there's no `validationMode` option — it always warns and carries on.

For checks that must block the pipeline, use a [`validate` step](../dsl-syntax/validate) (see below).

## Validation rules

The validator checks the following against the schema.

### Required fields

```yaml
Pet:
  required:
    - id
    - name
```

A response missing `name` is reported:

```json
{ "id": "123" }  // warning: missing required property 'name'
```

### Type checking

```yaml
Pet:
  properties:
    id:
      type: string
    age:
      type: integer
```

```json
{ "id": 123, "age": "five" }
// warnings: id expected string, age expected integer
```

### Enum

```yaml
Pet:
  properties:
    status:
      type: string
      enum: [available, pending, sold]
```

```json
{ "status": "active" }  // warning: value not in enum
```

### Numeric and string constraints

`minimum`/`maximum` for numbers, and `minLength`/`maxLength`/`pattern` for strings, are all checked.

### Arrays

```yaml
Pets:
  type: array
  items:
    $ref: '#/components/schemas/Pet'
```

`minItems`/`maxItems` are checked, and each item is validated against the item schema.

### Nested objects

```yaml
Pet:
  properties:
    owner:
      $ref: '#/components/schemas/Owner'
```

Nested object properties are validated recursively, including `additionalProperties` when the schema sets it.

## Hard validation with the validate step

Schema validation only logs. To stop the pipeline on bad data, add a `validate` step. Each `assume` is a condition; a failed assumption throws and aborts the mission:

```vague
action FetchOrder {
  call API.getOrder

  validate response {
    assume .total >= 0
    assume .items is array
    assume length(.items) > 0
  }

  store response -> orders { key: .id }
}
```

## Programmatic validation

The validator is also exported for direct use:

```typescript
import { validateResponse } from 'reqon-dsl';

const result = validateResponse(data, schema);
if (!result.valid) {
  for (const err of result.errors) {
    console.warn(`${err.path}: ${err.message}`);
  }
}
```

## Troubleshooting

### Warnings you didn't expect

The spec may be out of date with the live API. Update the spec, or check for an API version change.

### Validation isn't running

Confirm all of these:

- The source is declared with `from "./spec.yaml"`.
- `validateResponses: true` is set on the source.
- You're using `call Source.operationId` (not a plain `get`/`post`).
- The operation defines a `200` JSON response schema.
- You're running with `--verbose` so the warnings are visible.
