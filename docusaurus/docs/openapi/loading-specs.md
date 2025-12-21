---
sidebar_position: 2
---

# Loading OpenAPI Specs

Reqon can load OpenAPI specifications from files or URLs.

## Local files

### YAML format

```vague
source API from "./openapi.yaml" {
  auth: bearer
}
```

### JSON format

```vague
source API from "./openapi.json" {
  auth: bearer
}
```

### Relative paths

```vague
// Relative to mission file
source API from "./specs/api.yaml"

// Absolute path
source API from "/home/user/specs/api.yaml"
```

## Remote URLs

### Public specs

```vague
source Petstore from "https://petstore3.swagger.io/api/v3/openapi.json" {
  auth: none
}
```

### Authenticated specs

```vague
source PrivateAPI from "https://api.company.com/openapi.json" {
  auth: bearer,
  specAuth: {
    type: "bearer",
    token: env("SPEC_TOKEN")
  }
}
```

## Spec caching

Reqon caches resolved specs:

```vague
// First run: downloads and caches
source API from "https://api.example.com/openapi.json"

// Subsequent runs: uses cache
```

### Cache location

```
.vague-data/
└── oas-cache/
    └── api.example.com-openapi.json
```

### Force refresh

```bash
# Clear cache
rm -rf .vague-data/oas-cache/

# Or use --no-cache flag
reqon mission.vague --no-oas-cache
```

## Spec structure

### Minimum required

```yaml
openapi: 3.0.0
info:
  title: My API
  version: 1.0.0
servers:
  - url: https://api.example.com
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: Success
```

### Full example

```yaml
openapi: 3.0.0
info:
  title: E-commerce API
  version: 2.0.0
  description: API for managing products and orders

servers:
  - url: https://api.example.com/v2
    description: Production
  - url: https://staging.api.example.com/v2
    description: Staging

paths:
  /products:
    get:
      operationId: listProducts
      summary: List all products
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: Product list
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Product'

  /products/{id}:
    get:
      operationId: getProduct
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Product details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'

components:
  schemas:
    Product:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        price:
          type: number
      required:
        - id
        - name
```

## Server selection

### Default server

Uses first server in spec:

```yaml
servers:
  - url: https://api.example.com  # Used by default
  - url: https://staging.example.com
```

### Override Base URL

```vague
source API from "./spec.yaml" {
  auth: bearer,
  base: "https://custom.example.com"  # Overrides spec
}
```

### Environment-based

```vague
source API from "./spec.yaml" {
  auth: bearer,
  base: env("API_BASE_URL")
}
```

## Reference resolution

Reqon resolves `$ref` references:

```yaml
# References within same file
$ref: '#/components/schemas/Product'

# External file references
$ref: './schemas/product.yaml'
```

## Validation

### On load

Reqon validates the spec structure:

```
[Reqon] Loading OpenAPI spec from ./api.yaml
[Reqon] Spec valid: 15 operations found
```

### Invalid specs

```
[Reqon] Error: Invalid OpenAPI spec
  - Missing required field: info.version
  - Invalid path: /items must start with /
```

## Multiple specs

### Per-source

```vague
mission MultiAPI {
  source Products from "./products.yaml" { auth: bearer }
  source Orders from "./orders.yaml" { auth: bearer }
  source Users from "./users.yaml" { auth: oauth2 }

  action SyncAll {
    call Products.listProducts
    call Orders.listOrders
    call Users.listUsers
  }
}
```

### Shared components

If specs share schemas, use a single bundled spec:

```vague
source API from "./bundled-api.yaml" { auth: bearer }
```

## Troubleshooting

### "Spec not found"

Check file path:

```bash
ls -la ./openapi.yaml
```

### "Invalid spec"

Validate externally:

```bash
npx swagger-cli validate ./openapi.yaml
```

### "Operation not found"

Check operation ID matches exactly:

```yaml
paths:
  /items:
    get:
      operationId: listItems  # Must match call API.listItems
```

### Network issues

For remote specs:

```bash
# Test connectivity
curl -I https://api.example.com/openapi.json
```
