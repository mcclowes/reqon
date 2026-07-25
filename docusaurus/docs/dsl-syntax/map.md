---
sidebar_position: 3
---

# Map transformations

Map steps transform data from one shape to another. They're used to normalize API responses, enrich data, and prepare data for storage.

## Basic syntax

```vague
map sourceData -> TargetSchema {
  field: expression,
  anotherField: expression
}
```

## Simple mapping

```vague
action TransformUser {
  get "/users/123"

  map response -> User {
    id: .id,
    name: .name,
    email: .email
  }

  store response -> users { key: .id }
}
```

## Field access

### Direct access

```vague
map user -> Output {
  id: .id,
  name: .name
}
```

### Nested access

```vague
map user -> Output {
  userId: .id,
  street: .address.street,
  city: .address.city,
  country: .address.country
}
```

### Array access

```vague
map order -> Output {
  firstItem: .items[0],
  lastItem: .items[length(.items) - 1]
}
```

## Expressions

A field's value is a normal expression. For detailed expression syntax, see the [Expressions](./expressions) page and the [Vague documentation](https://github.com/mcclowes/vague).

### String operations

The `+` operator concatenates strings. There are no string functions like `lowercase`, `substring`, or `split`:

```vague
map user -> Output {
  fullName: .firstName + " " + .lastName,
  greeting: "Hello, " + .name
}
```

### Numeric operations

```vague
map order -> Output {
  subtotal: .price * .quantity,
  tax: .price * .quantity * 0.1,
  total: .price * .quantity * 1.1,
  discounted: .total * (1 - .discountPercent / 100)
}
```

### Conditional expressions

Use the ternary operator `condition ? a : b`. There's no `if/then/else` expression form:

```vague
map user -> Output {
  status: .active ? "Active" : "Inactive",
  tier: .totalSpent > 10000 ? "Gold"
        : .totalSpent > 5000 ? "Silver"
        : "Bronze"
}
```

### Pattern matching in maps

A match expression compares a value against literal patterns with `=>` and returns the matching arm's value:

```vague
map order -> Output {
  statusLabel: match .status {
    "pending" => "Awaiting Processing",
    "processing" => "In Progress",
    "shipped" => "On the Way",
    "delivered" => "Completed",
    _ => "Unknown"
  }
}
```

## Nested mapping

### Static nested objects

```vague
map user -> Output {
  id: .id,
  profile: {
    name: .name,
    email: .email,
    phone: .phone
  },
  metadata: {
    createdAt: .created_at,
    updatedAt: .updated_at
  }
}
```

## Combining data

### From multiple sources

```vague
action EnrichOrders {
  for order in orders {
    get "/customers/{order.customerId}"

    map order -> EnrichedOrder {
      id: order.id,
      total: order.total,
      customer: {
        id: response.id,
        name: response.name,
        email: response.email
      }
    }

    store order -> enrichedOrders { key: .id }
  }
}
```

## Null handling

### Default values

The `or` operator returns its left side when truthy, otherwise the right side, which makes it a handy default:

```vague
map user -> Output {
  name: .name or "Unknown",
  email: .email or "no-email@example.com",
  phone: .phone or null
}
```

### Null checks

```vague
map user -> Output {
  hasEmail: not (.email == null),
  displayEmail: not (.email == null) ? .email : "Not provided"
}
```

## Computed fields

`length` and `sum` are built in. `sum` takes an array of numbers:

```vague
map invoice -> Output {
  id: .id,
  lineItems: .items,
  subtotal: sum(.amounts),
  taxRate: 0.1,
  tax: sum(.amounts) * 0.1,
  total: sum(.amounts) * 1.1,
  itemCount: length(.items)
}
```

## Renaming fields

```vague
// Transform an API response to a standard format
map xeroInvoice -> StandardInvoice {
  id: .InvoiceID,
  number: .InvoiceNumber,
  customerId: .Contact.ContactID,
  customerName: .Contact.Name,
  amount: .Total,
  status: .Status,
  createdAt: .DateString
}
```

## Flattening nested data

```vague
map order -> FlatOrder {
  orderId: .id,
  orderDate: .createdAt,
  customerName: .customer.name,
  customerEmail: .customer.email,
  shippingStreet: .shipping.address.street,
  shippingCity: .shipping.address.city,
  total: .total
}
```

## Aggregation

`length` and `sum` work over arrays. There's no `map`, `filter`, or `avg` function, so aggregate over arrays you already have rather than deriving them inline:

```vague
map order -> Summary {
  itemCount: length(.items),
  totalRevenue: sum(.amounts),
  averageItem: sum(.amounts) / length(.items)
}
```

## Complete example

```vague
mission TransformXeroData {
  source Xero { auth: oauth2, base: "https://api.xero.com/api.xro/2.0" }

  store invoices: file("invoices")

  action TransformInvoices {
    get "/Invoices"

    for invoice in response.Invoices {
      map invoice -> StandardInvoice {
        // Identifiers
        id: .InvoiceID,
        number: .InvoiceNumber,
        type: match .Type {
          "ACCREC" => "receivable",
          "ACCPAY" => "payable",
          _ => "unknown"
        },

        // Customer info
        customer: {
          id: .Contact.ContactID,
          name: .Contact.Name,
          email: .Contact.EmailAddress or null
        },

        // Line items (kept as-is from the source)
        items: .LineItems,

        // Totals
        subtotal: .SubTotal,
        tax: .TotalTax,
        total: .Total,

        // Status
        status: .Status,
        isPaid: .Status == "PAID",

        // Dates
        date: .DateString,
        dueDate: .DueDateString,

        // Metadata
        createdAt: .UpdatedDateUTC,
        source: "xero"
      }

      store invoice -> invoices { key: .id, upsert: true }
    }
  }

  run TransformInvoices
}
```
