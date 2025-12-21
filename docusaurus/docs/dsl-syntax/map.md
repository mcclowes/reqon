---
sidebar_position: 3
---

# Map Transformations

Map steps transform data from one shape to another. They're used to normalize API responses, enrich data, and prepare data for storage.

## Basic Syntax

```reqon
map sourceData -> TargetSchema {
  field: expression,
  anotherField: expression
}
```

## Simple Mapping

```reqon
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

## Field Access

### Direct Access

```reqon
map user -> Output {
  id: .id,
  name: .name
}
```

### Nested Access

```reqon
map user -> Output {
  userId: .id,
  street: .address.street,
  city: .address.city,
  country: .address.country
}
```

### Array Access

```reqon
map order -> Output {
  firstItem: .items[0],
  lastItem: .items[length(.items) - 1]
}
```

## Expressions

For detailed expression syntax, see the [Vague documentation](https://github.com/mcclowes/vague).

### String Operations

```reqon
map user -> Output {
  fullName: concat(.firstName, " ", .lastName),
  email: lowercase(.email),
  initials: concat(substring(.firstName, 0, 1), substring(.lastName, 0, 1)),
  domain: split(.email, "@")[1]
}
```

### Numeric Operations

```reqon
map order -> Output {
  subtotal: .price * .quantity,
  tax: .price * .quantity * 0.1,
  total: .price * .quantity * 1.1,
  discounted: .total * (1 - .discountPercent / 100)
}
```

### Conditional Expressions

```reqon
map user -> Output {
  status: if .active then "Active" else "Inactive",
  tier: if .totalSpent > 10000 then "Gold"
        else if .totalSpent > 5000 then "Silver"
        else "Bronze"
}
```

### Pattern Matching in Maps

```reqon
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

## Nested Mapping

### Static Nested Objects

```reqon
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

### Mapping Arrays

```reqon
map order -> Output {
  id: .id,
  items: .lineItems.map(item => {
    productId: item.product_id,
    name: item.product_name,
    quantity: item.qty,
    price: item.unit_price
  })
}
```

## Combining Data

### From Multiple Sources

```reqon
action EnrichOrders {
  for order in orders {
    get concat("/customers/", order.customerId)

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

### Merging Objects

```reqon
map source -> Output {
  ...baseData,
  ...additionalData,
  overriddenField: "new value"
}
```

## Date Transformations

```reqon
map event -> Output {
  timestamp: parseDate(.created_at),
  formattedDate: formatDate(.created_at, "YYYY-MM-DD"),
  year: year(.created_at),
  dayOfWeek: dayOfWeek(.created_at)
}
```

## Null Handling

### Default Values

```reqon
map user -> Output {
  name: .name or "Unknown",
  email: .email or "no-email@example.com",
  phone: .phone or null
}
```

### Null Checks

```reqon
map user -> Output {
  hasEmail: .email != null,
  displayEmail: if .email != null then .email else "Not provided"
}
```

## Type Coercion

```reqon
map data -> Output {
  id: toString(.id),
  count: toNumber(.count),
  isActive: toBoolean(.active),
  tags: toArray(.tags)
}
```

## Computed Fields

```reqon
map invoice -> Output {
  id: .id,
  lineItems: .items,
  subtotal: sum(.items.map(.amount)),
  taxRate: 0.1,
  tax: sum(.items.map(.amount)) * 0.1,
  total: sum(.items.map(.amount)) * 1.1,
  itemCount: length(.items)
}
```

## Renaming Fields

```reqon
// Transform API response to standard format
map xeroInvoice -> StandardInvoice {
  id: .InvoiceID,
  number: .InvoiceNumber,
  customerId: .Contact.ContactID,
  customerName: .Contact.Name,
  amount: .Total,
  status: lowercase(.Status),
  createdAt: .DateString
}
```

## Flattening Nested Data

```reqon
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

## Grouping and Aggregation

```reqon
map orders -> Summary {
  totalOrders: length(orders),
  totalRevenue: sum(orders.map(.total)),
  averageOrder: sum(orders.map(.total)) / length(orders),
  byStatus: {
    pending: length(filter(orders, .status == "pending")),
    completed: length(filter(orders, .status == "completed"))
  }
}
```

## Complete Example

```reqon
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

        // Line items
        items: .LineItems.map(item => {
          description: item.Description,
          quantity: item.Quantity,
          unitPrice: item.UnitAmount,
          total: item.LineAmount,
          taxAmount: item.TaxAmount or 0
        }),

        // Totals
        subtotal: .SubTotal,
        tax: .TotalTax,
        total: .Total,

        // Status
        status: lowercase(.Status),
        isPaid: .Status == "PAID",

        // Dates
        date: parseDate(.DateString),
        dueDate: parseDate(.DueDateString),

        // Metadata
        createdAt: parseDate(.UpdatedDateUTC),
        source: "xero"
      }

      store invoice -> invoices { key: .id, upsert: true }
    }
  }

  run TransformInvoices
}
```
