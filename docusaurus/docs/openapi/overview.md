---
sidebar_position: 1
---

# OpenAPI Integration Overview

Reqon integrates with OpenAPI (Swagger) specifications for type-safe API calls and response validation.

## Benefits

- **Type-safe operations**: Call APIs by operation ID
- **Auto-discovery**: Base URL and endpoints from spec
- **Response validation**: Validate against schema definitions
- **Documentation sync**: API changes reflected automatically

## Quick Start

### 1. Define Source from Spec

```vague
source Petstore from "./petstore.yaml" {
  auth: bearer,
  validateResponses: true
}
```

### 2. Call Operations

```vague
action FetchPets {
  call Petstore.listPets { params: { limit: 100 } }
  store response -> pets { key: .id }

  call Petstore.getPetById { params: { petId: "123" } }
  store response -> petDetails { key: .id }
}
```

## How It Works

### Loading Specs

Reqon loads and parses OpenAPI specs:

```vague
// Local file
source API from "./api.yaml" { auth: bearer }

// URL
source API from "https://api.example.com/openapi.json" { auth: bearer }
```

### Operation Resolution

Reqon maps `call Source.operationId` to:

```yaml
# OpenAPI spec
paths:
  /pets:
    get:
      operationId: listPets
      # Reqon uses: GET /pets
```

### Base URL Extraction

Base URL from spec's `servers`:

```yaml
servers:
  - url: https://api.example.com/v1
```

## Configuration Options

```vague
source API from "./spec.yaml" {
  auth: bearer,
  validateResponses: true,  # Validate responses against schema
  headers: {                # Additional headers
    "X-Custom": "value"
  }
}
```

## Example Workflow

```vague
mission PetstoreSync {
  source Petstore from "./petstore.yaml" {
    auth: api_key,
    validateResponses: true
  }

  store pets: file("pets")

  action SyncPets {
    // List all pets
    call Petstore.listPets {
      params: { limit: 100 }
    }

    for pet in response {
      // Get full details
      call Petstore.getPetById {
        params: { petId: pet.id }
      }

      store response -> pets { key: .id }
    }
  }

  action CreatePet {
    call Petstore.addPet {
      body: {
        name: "Fluffy",
        tag: "cat"
      }
    }
  }

  run SyncPets
}
```

## Comparison: Traditional vs OAS

### Traditional Approach

```vague
source API { auth: bearer, base: "https://api.example.com" }

action Fetch {
  get "/pets"
  get concat("/pets/", id)
}
```

### OAS Approach

```vague
source API from "./spec.yaml" { auth: bearer }

action Fetch {
  call API.listPets
  call API.getPetById { params: { petId: id } }
}
```

### Benefits of OAS

| Aspect | Traditional | OAS |
|--------|-------------|-----|
| Type safety | None | Schema validation |
| Endpoint updates | Manual | Automatic |
| Documentation | Separate | Integrated |
| IDE support | Limited | Full autocomplete |

## Supported Spec Formats

- OpenAPI 3.0.x (recommended)
- OpenAPI 3.1.x
- Swagger 2.0 (converted internally)

### Format Detection

```vague
// YAML
source API from "./spec.yaml"

// JSON
source API from "./spec.json"

// Remote
source API from "https://api.example.com/openapi.json"
```

## Common Patterns

### Fetch with Pagination

```vague
call API.listItems {
  params: { limit: 100 },
  paginate: cursor(cursor, 100, "nextCursor"),
  until: response.nextCursor == null
}
```

### Conditional Operations

```vague
action SyncItem {
  call API.getItem { params: { id: itemId } }

  match response {
    { exists: false } -> {
      call API.createItem { body: itemData }
    },
    _ -> {
      call API.updateItem { params: { id: itemId }, body: itemData }
    }
  }
}
```

## Next Steps

- [Loading Specs](./loading-specs) - Loading and caching specs
- [Operation Calls](./operation-calls) - Calling operations
- [Response Validation](./response-validation) - Validating responses
