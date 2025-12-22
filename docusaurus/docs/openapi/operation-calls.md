---
sidebar_position: 3
---

# Operation calls

Call OpenAPI operations using the `call` syntax with operation IDs.

## Basic syntax

```vague
call SourceName.operationId
call SourceName.operationId { options }
```

## Simple calls

### GET operations

```vague
// OpenAPI: GET /pets with operationId: listPets
call Petstore.listPets

// OpenAPI: GET /pets/{petId} with operationId: getPetById
call Petstore.getPetById { params: { petId: "123" } }
```

### POST operations

```vague
// OpenAPI: POST /pets with operationId: addPet
call Petstore.addPet {
  body: {
    name: "Fluffy",
    tag: "cat"
  }
}
```

### PUT/PATCH operations

```vague
// PUT - full replacement
call API.updateItem {
  params: { id: "123" },
  body: { name: "New Name", status: "active" }
}

// PATCH - partial update
call API.patchItem {
  params: { id: "123" },
  body: { status: "inactive" }
}
```

### DELETE operations

```vague
call API.deleteItem {
  params: { id: "123" }
}
```

## Parameters

### Path parameters

For `/pets/{petId}`:

```vague
call Petstore.getPetById {
  params: { petId: "123" }
}
// Generates: GET /pets/123
```

### Query parameters

For `/pets?limit=10&status=available`:

```vague
call Petstore.listPets {
  params: {
    limit: 10,
    status: "available"
  }
}
```

### Combined parameters

```vague
call API.listUserOrders {
  params: {
    userId: "123",      // Path: /users/{userId}/orders
    status: "pending",  // Query: ?status=pending
    limit: 50           // Query: ?limit=50
  }
}
// Generates: GET /users/123/orders?status=pending&limit=50
```

## Request body

### Simple body

```vague
call API.createItem {
  body: {
    name: "Test Item",
    price: 29.99
  }
}
```

### Dynamic body

```vague
for item in items {
  call API.createItem {
    body: {
      name: item.name,
      price: item.price,
      metadata: {
        source: "sync",
        timestamp: now()
      }
    }
  }
}
```

### From variable

```vague
map data -> Payload {
  name: .name,
  status: "active"
}

call API.createItem { body: data }
```

## Headers

### Custom headers

```vague
call API.listItems {
  headers: {
    "X-Request-ID": uuid(),
    "Accept-Language": "en-US"
  }
}
```

### Tenant headers

```vague
call Xero.listInvoices {
  headers: {
    "Xero-Tenant-Id": env("XERO_TENANT_ID")
  }
}
```

## Pagination with operations

```vague
call API.listItems {
  params: { limit: 100 },
  paginate: offset(offset, 100),
  until: length(response.items) == 0
}
```

### Cursor pagination

```vague
call API.listItems {
  paginate: cursor(cursor, 100, "meta.nextCursor"),
  until: response.meta.nextCursor == null
}
```

## Combining options

```vague
call API.searchItems {
  params: {
    query: "test",
    limit: 50
  },
  headers: {
    "X-Custom": "value"
  },
  paginate: cursor(after, 50, "pageInfo.endCursor"),
  until: response.pageInfo.hasNextPage == false,
  retry: {
    maxAttempts: 3,
    backoff: exponential
  }
}
```

## Response handling

```vague
action FetchWithHandling {
  call API.getItem { params: { id: itemId } }

  match response {
    { data: item } -> store item -> items { key: .id },
    { error: e } -> abort e,
    _ -> abort "Unexpected response"
  }
}
```

## Operation chaining

```vague
action CreateAndFetch {
  // Create
  call API.createItem {
    body: { name: "New Item" }
  }

  // response.id from creation
  call API.getItem {
    params: { id: response.id }
  }

  store response -> items { key: .id }
}
```

## Error handling

```vague
call API.riskyOperation { params: { id: "123" } }

match response {
  { code: 400 } -> abort "Invalid request",
  { code: 401 } -> jump RefreshToken then retry,
  { code: 404 } -> skip,
  { code: 429 } -> retry { delay: 60000 },
  { code: 500 } -> retry { maxAttempts: 3 },
  _ -> continue
}
```

## Dynamic operation calls

### Based on condition

```vague
action SmartSync {
  call API.checkItem { params: { id: item.id } }

  match response {
    { exists: false } -> {
      call API.createItem { body: item }
    },
    { exists: true, needsUpdate: true } -> {
      call API.updateItem { params: { id: item.id }, body: item }
    },
    _ -> continue
  }
}
```

## Best practices

### Match Operation IDs

```yaml
# In OpenAPI spec
operationId: listUsers  # camelCase recommended
```

```vague
call API.listUsers  # Match exactly
```

### Use descriptive operations

```yaml
# Good
operationId: createInvoice
operationId: getInvoiceById
operationId: listInvoicesByCustomer

# Avoid
operationId: post1
operationId: get2
```

### Handle all response codes

```vague
call API.operation

match response {
  { code: 200 } -> continue,
  { code: 201 } -> continue,
  { code: 204 } -> continue,
  { code: 400 } -> abort "Bad request",
  { code: 401 } -> jump RefreshAuth then retry,
  { code: 404 } -> skip,
  { code: 500 } -> retry { maxAttempts: 3 },
  _ -> abort "Unexpected response"
}
```
