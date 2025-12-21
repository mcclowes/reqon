---
sidebar_position: 3
---

# Operation Calls

Call OpenAPI operations using the `call` syntax with operation IDs.

## Basic Syntax

```reqon
call SourceName.operationId
call SourceName.operationId { options }
```

## Simple Calls

### GET Operations

```reqon
// OpenAPI: GET /pets with operationId: listPets
call Petstore.listPets

// OpenAPI: GET /pets/{petId} with operationId: getPetById
call Petstore.getPetById { params: { petId: "123" } }
```

### POST Operations

```reqon
// OpenAPI: POST /pets with operationId: addPet
call Petstore.addPet {
  body: {
    name: "Fluffy",
    tag: "cat"
  }
}
```

### PUT/PATCH Operations

```reqon
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

### DELETE Operations

```reqon
call API.deleteItem {
  params: { id: "123" }
}
```

## Parameters

### Path Parameters

For `/pets/{petId}`:

```reqon
call Petstore.getPetById {
  params: { petId: "123" }
}
// Generates: GET /pets/123
```

### Query Parameters

For `/pets?limit=10&status=available`:

```reqon
call Petstore.listPets {
  params: {
    limit: 10,
    status: "available"
  }
}
```

### Combined Parameters

```reqon
call API.listUserOrders {
  params: {
    userId: "123",      // Path: /users/{userId}/orders
    status: "pending",  // Query: ?status=pending
    limit: 50           // Query: ?limit=50
  }
}
// Generates: GET /users/123/orders?status=pending&limit=50
```

## Request Body

### Simple Body

```reqon
call API.createItem {
  body: {
    name: "Test Item",
    price: 29.99
  }
}
```

### Dynamic Body

```reqon
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

### From Variable

```reqon
map data -> Payload {
  name: .name,
  status: "active"
}

call API.createItem { body: data }
```

## Headers

### Custom Headers

```reqon
call API.listItems {
  headers: {
    "X-Request-ID": uuid(),
    "Accept-Language": "en-US"
  }
}
```

### Tenant Headers

```reqon
call Xero.listInvoices {
  headers: {
    "Xero-Tenant-Id": env("XERO_TENANT_ID")
  }
}
```

## Pagination with Operations

```reqon
call API.listItems {
  params: { limit: 100 },
  paginate: offset(offset, 100),
  until: length(response.items) == 0
}
```

### Cursor Pagination

```reqon
call API.listItems {
  paginate: cursor(cursor, 100, "meta.nextCursor"),
  until: response.meta.nextCursor == null
}
```

## Combining Options

```reqon
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

## Response Handling

```reqon
action FetchWithHandling {
  call API.getItem { params: { id: itemId } }

  match response {
    { data: item } -> store item -> items { key: .id },
    { error: e } -> abort e,
    _ -> abort "Unexpected response"
  }
}
```

## Operation Chaining

```reqon
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

## Error Handling

```reqon
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

## Dynamic Operation Calls

### Based on Condition

```reqon
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

## Best Practices

### Match Operation IDs

```yaml
# In OpenAPI spec
operationId: listUsers  # camelCase recommended
```

```reqon
call API.listUsers  # Match exactly
```

### Use Descriptive Operations

```yaml
# Good
operationId: createInvoice
operationId: getInvoiceById
operationId: listInvoicesByCustomer

# Avoid
operationId: post1
operationId: get2
```

### Handle All Response Codes

```reqon
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
