---
sidebar_position: 4
---

# Response validation

Reqon can validate API responses against OpenAPI schema definitions.

## Enabling validation

```vague
source API from "./spec.yaml" {
  auth: bearer,
  validateResponses: true
}
```

## How it works

### Schema matching

OpenAPI spec:
```yaml
paths:
  /pets/{petId}:
    get:
      operationId: getPetById
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'

components:
  schemas:
    Pet:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
        name:
          type: string
        tag:
          type: string
```

Reqon validates:
```vague
call API.getPetById { params: { petId: "123" } }
// Validates response against Pet schema
```

## Validation modes

### Strict mode

Fails on schema mismatch:

```vague
source API from "./spec.yaml" {
  validateResponses: true,
  validationMode: "strict"
}
```

### Warning mode

Logs warning but continues:

```vague
source API from "./spec.yaml" {
  validateResponses: true,
  validationMode: "warn"
}
```

### Off

No validation (default):

```vague
source API from "./spec.yaml" {
  validateResponses: false
}
```

## Validation rules

### Required fields

```yaml
Pet:
  required:
    - id
    - name
```

Response missing `name` triggers error:
```json
{ "id": "123" }  // Error: missing required field 'name'
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
// Errors: id should be string, age should be integer
```

### Enum validation

```yaml
Pet:
  properties:
    status:
      type: string
      enum: [available, pending, sold]
```

```json
{ "status": "active" }  // Error: status not in enum
```

### Array validation

```yaml
Pets:
  type: array
  items:
    $ref: '#/components/schemas/Pet'
```

Each item in array is validated.

## Error handling

### With validation errors

```vague
call API.getPet { params: { id: "123" } }

match response {
  { validationErrors: errors } -> {
    store {
      operation: "getPet",
      errors: errors
    } -> validationFailures
    skip
  },
  _ -> store response -> pets { key: .id }
}
```

### Catching specific errors

```vague
match response {
  { validationErrors: e } where includes(e, "missing required") -> {
    // Handle missing fields
    abort "Incomplete data from API"
  },
  { validationErrors: e } where includes(e, "type mismatch") -> {
    // Handle type issues
    store response -> typeIssues { key: response.id }
    skip
  },
  _ -> continue
}
```

## Custom validation

### Additional constraints

Beyond schema validation:

```vague
call API.getOrder { params: { id: orderId } }

// Schema validation happens automatically

// Additional business validation
validate response {
  assume .total >= 0,
  assume .items is array,
  assume length(.items) > 0,
  assume .status != "invalid"
}

store response -> orders { key: .id }
```

### Combining validations

```vague
action ValidatedFetch {
  call API.listItems

  for item in response.items {
    // Schema already validated by OAS

    // Additional validation
    validate item {
      assume .price > 0,
      assume .quantity >= 0
    }

    match item {
      _ where .validationErrors != null -> {
        queue invalid { item: item }
        skip
      },
      _ -> store item -> items { key: .id }
    }
  }
}
```

## Schema references

### Component schemas

```yaml
components:
  schemas:
    Pet:
      type: object
      properties:
        id: { type: string }
        owner:
          $ref: '#/components/schemas/Owner'
    Owner:
      type: object
      properties:
        name: { type: string }
```

Nested schemas are validated:

```json
{
  "id": "123",
  "owner": {
    "name": 123  // Error: name should be string
  }
}
```

### OneOf/AnyOf

```yaml
Response:
  oneOf:
    - $ref: '#/components/schemas/Success'
    - $ref: '#/components/schemas/Error'
```

Validates against matching schema.

## Best practices

### Use validation in development

```vague
source API from "./spec.yaml" {
  validateResponses: env("NODE_ENV") != "production"
}
```

### Log validation failures

```vague
match response {
  { validationErrors: e } -> {
    store {
      timestamp: now(),
      operation: currentOperation,
      errors: e,
      response: response
    } -> validationLog
  },
  _ -> continue
}
```

### Keep specs updated

Ensure spec matches actual API:
- Run validation in CI/CD
- Update spec when API changes
- Use spec versioning

### Handle gracefully

```vague
// Don't fail hard on validation
source API from "./spec.yaml" {
  validateResponses: true,
  validationMode: "warn"
}

// Handle in code
match response {
  { validationErrors: _ } -> {
    // Log and continue with caution
  },
  _ -> continue
}
```

## Troubleshooting

### "Schema not found"

Check component name matches:

```yaml
$ref: '#/components/schemas/Pet'  # Case sensitive
```

### False positives

Schema may be outdated:
- Update spec from API provider
- Check for API version changes

### Performance

Validation adds overhead:
- Disable in production if not needed
- Use sampling for high-volume APIs
