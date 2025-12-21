---
sidebar_position: 5
---

# Schemas

**Schemas** define data shapes for validation and pattern matching. They're used to validate responses, route data based on structure, and document expected data formats.

## Basic Syntax

```vague
schema SchemaName {
  field: type,
  optionalField: type?,
  nestedField: {
    subField: type
  }
}
```

## Field Types

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text value | `"hello"` |
| `number` | Numeric value | `42`, `3.14` |
| `boolean` | True or false | `true`, `false` |
| `date` | Date/datetime | `"2024-01-20"` |
| `array` | Array of values | `[1, 2, 3]` |
| `object` | Nested object | `{ a: 1 }` |
| `any` | Any type | anything |
| `null` | Null value | `null` |

## Optional Fields

Use `?` suffix for optional fields:

```vague
schema User {
  id: string,
  name: string,
  email: string?,
  phone: string?
}
```

## Typed Arrays

Specify array element types:

```vague
schema UserList {
  users: array<User>,
  total: number
}

schema Order {
  id: string,
  items: array<{
    productId: string,
    quantity: number,
    price: number
  }>
}
```

## Nested Schemas

Define complex nested structures:

```vague
schema Invoice {
  id: string,
  customer: {
    id: string,
    name: string,
    address: {
      street: string,
      city: string,
      country: string
    }
  },
  lineItems: array<{
    description: string,
    amount: number
  }>,
  total: number
}
```

## Schema References

Reference other schemas:

```vague
schema Address {
  street: string,
  city: string,
  postalCode: string,
  country: string
}

schema Customer {
  id: string,
  name: string,
  billingAddress: Address,
  shippingAddress: Address?
}
```

## Using Schemas for Validation

Validate data against schemas:

```vague
action ValidateResponse {
  get "/users"

  for user in response.users {
    validate user {
      assume .id is string,
      assume .name is string,
      assume .email is string
    }
    store user -> validUsers { key: .id }
  }
}
```

## Using Schemas for Pattern Matching

Route data based on schema matches:

```vague
schema SuccessResponse {
  data: any,
  status: string
}

schema ErrorResponse {
  error: string,
  code: number
}

schema RateLimitResponse {
  error: string,
  retryAfter: number
}

action HandleResponse {
  get "/data"

  match response {
    SuccessResponse -> store response.data -> data { key: .id },
    RateLimitResponse -> retry { delay: response.retryAfter * 1000 },
    ErrorResponse -> abort response.error,
    _ -> abort "Unknown response format"
  }
}
```

## Schema Matching Rules

Schemas match when:
1. All required fields are present
2. Field types match
3. Optional fields, if present, match their types

```vague
schema StrictUser {
  id: string,     // Required
  name: string,   // Required
  email: string?  // Optional
}

// Matches: { id: "1", name: "John" }
// Matches: { id: "1", name: "John", email: "john@example.com" }
// Does NOT match: { id: 1, name: "John" }  // id is number, not string
// Does NOT match: { id: "1" }  // missing name
```

## Type Checking with `is`

Use `is` for inline type checking:

```vague
validate response {
  assume .items is array,
  assume .count is number,
  assume .status is string
}
```

## Combining Schemas

Use schemas in complex match patterns:

```vague
schema PaginatedResponse {
  data: array,
  meta: {
    page: number,
    totalPages: number,
    hasNext: boolean
  }
}

schema EmptyResponse {
  data: array,
  meta: {
    total: number
  }
}

action FetchPaginated {
  get "/items" { paginate: page(page, 100) }

  match response {
    PaginatedResponse where response.meta.hasNext == true -> continue,
    PaginatedResponse -> store response.data -> items { key: .id },
    EmptyResponse -> skip,
    _ -> abort "Unexpected response"
  }
}
```

## Schema Inheritance (via Vague)

Extend schemas using Vague's composition:

```vague
schema BaseEntity {
  id: string,
  createdAt: date,
  updatedAt: date
}

schema User {
  ...BaseEntity,
  name: string,
  email: string
}

schema Order {
  ...BaseEntity,
  customerId: string,
  total: number
}
```

For advanced schema features, see the [Vague documentation](https://github.com/mcclowes/vague).

## Best Practices

### Define Schemas for API Responses

```vague
mission APISync {
  schema UserResponse {
    users: array<User>,
    pagination: {
      page: number,
      total: number
    }
  }

  schema User {
    id: string,
    name: string,
    email: string
  }
}
```

### Use Schemas for Error Handling

```vague
schema APIError {
  error: {
    message: string,
    code: string
  }
}

schema AuthError {
  error: {
    message: string,
    code: string
  },
  code: number  // HTTP status code
}

action Fetch {
  get "/data"

  match response {
    AuthError where .code == 401 -> jump RefreshToken then retry,
    APIError -> abort response.error.message,
    _ -> continue
  }
}
```

### Document Expected Formats

Schemas serve as documentation:

```vague
// XeroInvoice represents an invoice from Xero API
schema XeroInvoice {
  InvoiceID: string,
  InvoiceNumber: string,
  Type: string,  // ACCREC or ACCPAY
  Contact: {
    ContactID: string,
    Name: string
  },
  LineItems: array<{
    Description: string,
    Quantity: number,
    UnitAmount: number,
    LineAmount: number
  }>,
  Total: number,
  Status: string  // DRAFT, SUBMITTED, AUTHORISED, PAID
}
```

### Keep Schemas Close to Usage

Define schemas in the same mission where they're used:

```vague
mission XeroSync {
  // Schema definitions at the top
  schema XeroInvoice { /* ... */ }
  schema XeroContact { /* ... */ }

  // Then sources, stores, actions...
}
```

Or use multi-file missions to organize:

```
missions/xero-sync/
├── mission.vague
├── schemas/
│   ├── invoice.vague
│   └── contact.vague
└── actions/
    └── fetch.vague
```
