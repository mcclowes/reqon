---
sidebar_position: 3
---

# Operation calls

Call OpenAPI operations by operation ID with the `call` syntax.

## Basic syntax

```vague
call SourceName.operationId
call SourceName.operationId { options }
```

The method and path come from the spec. The options block accepts the same keys as a fetch step: `body`, `paginate`, `until`, `retry`, `since`, and `backfill`. There's no `params` or `headers` option.

## Simple calls

### GET operations

```vague
// OpenAPI: GET /pets, operationId listPets
call Petstore.listPets

// OpenAPI: GET /pets/{petId}, operationId getPetById
let petId = "123"
call Petstore.getPetById
```

### POST operations

```vague
// OpenAPI: POST /pets, operationId addPet
call Petstore.addPet {
  body: {
    name: "Fluffy",
    tag: "cat"
  }
}
```

### PUT, PATCH, and DELETE

```vague
let id = "123"

call API.updateItem {
  body: { name: "New Name", status: "active" }
}

call API.patchItem {
  body: { status: "inactive" }
}

call API.deleteItem
```

## Path parameters

Operation paths with placeholders are filled from context variables of the same name. For `GET /pets/{petId}`, bind a variable called `petId`:

```vague
let petId = "123"
call Petstore.getPetById
// Generates: GET /pets/123
```

Inside a loop, bind the placeholder from the current item:

```vague
for pet in pets {
  let petId = pet.id
  call Petstore.getPetById
  store response -> petDetails { key: .id }
}
```

Interpolated values are URL-encoded, so a path parameter can't inject extra path segments or a query string.

## Query parameters

There's no general query-parameter option. The query string is built from:

- `paginate` — pagination parameters (see below).
- `since` — the incremental-sync parameter or header.

If you need an arbitrary fixed query parameter, use a plain `get "/path?key=value"` fetch instead of an OAS `call`.

## Request body

### Inline body

```vague
call API.createItem {
  body: {
    name: "Test Item",
    price: 29.99
  }
}
```

### Body from a variable

```vague
map data -> Payload {
  name: .name,
  status: "active"
}

call API.createItem { body: data }
```

## Pagination

```vague
call API.listItems {
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
  paginate: cursor(after, 50, "pageInfo.endCursor"),
  until: response.pageInfo.hasNextPage == false,
  retry: {
    maxAttempts: 3,
    backoff: exponential
  }
}
```

## Response handling

After a call, the body is available as `response`. Use `match` on a schema, a guard, or the wildcard:

```vague
action FetchWithHandling {
  let id = itemId
  call API.getItem

  match response {
    Item -> store response -> items { key: .id },
    _ -> abort "Unexpected response"
  }
}
```

`match` arms match a schema name, `SchemaName where <guard>`, or `_`. Object or literal patterns aren't supported.

## Operation chaining

```vague
action CreateAndFetch {
  call API.createItem {
    body: { name: "New Item" }
  }

  // response.id from the creation
  let id = response.id
  call API.getItem

  store response -> items { key: .id }
}
```

## Error handling

Use flow directives in match arms. Note that `retry` uses the retry block keys (no `delay`), `abort` takes a bare string, and `jump` can chain a follow-up directive:

```vague
let id = itemId
call API.riskyOperation

match response {
  _ where response.code == 401 -> jump RefreshToken then retry,
  _ where response.code == 404 -> skip,
  _ where response.code == 429 -> retry { maxAttempts: 5, backoff: exponential },
  _ -> continue
}
```

## Best practices

### Match operation IDs exactly

```yaml
# In the OpenAPI spec
operationId: listUsers
```

```vague
call API.listUsers  // must match exactly
```

### Use descriptive operation IDs

```yaml
# Good
operationId: createInvoice
operationId: getInvoiceById

# Avoid
operationId: post1
operationId: get2
```
</content>
