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

## Quick start

### 1. Define source from spec

```vague
source Petstore from "./petstore.yaml" {
  auth: bearer,
  validateResponses: true
}
```

### 2. Call operations

```vague
action FetchPets {
  call Petstore.listPets
  store response -> pets { key: .id }

  let petId = "123"
  call Petstore.getPetById
  store response -> petDetails { key: .id }
}
```

Path parameters (like `{petId}`) are filled from context variables of the same name. The options block has no `params`; see [operation calls](./operation-calls).

## How it works

### Loading specs

Reqon loads and parses OpenAPI specs:

```vague
// Local file
source API from "./api.yaml" { auth: bearer }

// URL
source API from "https://api.example.com/openapi.json" { auth: bearer }
```

### Operation resolution

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

## Configuration options

```vague
source API from "./spec.yaml" {
  auth: bearer,
  validateResponses: true,  // Validate responses against schema
  headers: {                // Additional headers
    "X-Custom": "value"
  }
}
```

## Example workflow

```vague
mission PetstoreSync {
  source Petstore from "./petstore.yaml" {
    auth: bearer,
    validateResponses: true
  }

  store pets: file("pets")
  store petDetails: file("pet-details")

  action SyncPets {
    // List all pets
    call Petstore.listPets
    store response -> pets { key: .id }

    for pet in pets {
      // Get full details; getPetById's path is /pets/{petId}
      let petId = pet.id
      call Petstore.getPetById
      store response -> petDetails { key: .id }
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

### Traditional approach

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
  let petId = id
  call API.getPetById
}
```

### Benefits of OAS

| Aspect | Traditional | OAS |
|--------|-------------|-----|
| Type safety | None | Schema validation |
| Endpoint updates | Manual | Automatic |
| Documentation | Separate | Integrated |
| IDE support | Limited | Full autocomplete |

## Supported spec formats

- OpenAPI 3.0.x (recommended)
- OpenAPI 3.1.x
- Swagger 2.0 (converted internally)

### Format detection

```vague
// YAML
source API from "./spec.yaml"

// JSON
source API from "./spec.json"

// Remote
source API from "https://api.example.com/openapi.json"
```

## Common patterns

### Fetch with pagination

```vague
call API.listItems {
  paginate: cursor(cursor, 100, "nextCursor"),
  until: response.nextCursor == null
}
```

### Conditional operations

```vague
action SyncItem {
  let id = itemId
  call API.getItem

  match response {
    _ where response.exists == false -> {
      call API.createItem { body: itemData }
    },
    _ -> {
      call API.updateItem { body: itemData }
    }
  }
}
```

## Next steps

- [Loading Specs](./loading-specs) - Loading and caching specs
- [Operation Calls](./operation-calls) - Calling operations
- [Response Validation](./response-validation) - Validating responses
