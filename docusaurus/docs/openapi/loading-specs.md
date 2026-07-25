---
sidebar_position: 2
---

# Loading OpenAPI specs

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
source API from "./specs/api.yaml" {
  auth: bearer
}

// Absolute path
source API from "/home/user/specs/api.yaml" {
  auth: bearer
}
```

## Remote URLs

### Public specs

```vague
source Petstore from "https://petstore3.swagger.io/api/v3/openapi.json" {
  auth: none
}
```

### Private specs

A spec served behind auth must be reachable by the loader at parse time. There's no separate spec-credential option (`specAuth` isn't supported); fetch or vendor the spec locally if it needs credentials to download.

## Spec caching

Reqon caches parsed specs in memory for the duration of a run, keyed by spec path, so the same spec isn't parsed twice. The cache is per process and isn't written to disk, so there's no cache directory to clear and no cache flag — each fresh run reparses the spec.

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
  base: "https://custom.example.com"  // Overrides spec
}
```

The `base` value is a string literal.

## Reference resolution

Reqon resolves internal `$ref` references within the spec:

```yaml
$ref: '#/components/schemas/Product'
```

External `$ref` pointers (to other files or remote URLs) are not resolved by default. Resolving untrusted external references is an SSRF and resource-exhaustion risk, so the loader only follows internal `#/...` references unless external resolution is explicitly enabled. Bundle external references into a single spec before loading.

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
