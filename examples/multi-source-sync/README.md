# Multi-Source Sync Example

This example demonstrates the recommended file structure for Reqon projects with reusable transforms.

## File Structure

```
multi-source-sync/
├── mission.reqon                    # Main mission file
├── schemas/
│   ├── order/
│   │   ├── schema.reqon            # Order schema definitions
│   │   └── transform.reqon         # Order transformations
│   └── payment/
│       ├── schema.reqon            # Payment schema definitions
│       └── transform.reqon         # Payment transformations
└── README.md
```

## Key Concepts

### Transforms as First-Class Entities

Transforms are reusable, named transformation definitions that can be:
- Defined once and used multiple times
- Overloaded to handle multiple source schemas
- Tested independently

### Transform Overloading

Define multiple variants of a transform that are tried in order:

```reqon
transform ToUnifiedOrder {
  // Variant 1: Xero format
  (XeroInvoice) -> UnifiedOrder {
    id: "xero-" + .InvoiceID,
    amount: .Total
  }

  // Variant 2: Stripe format
  (StripeCharge) -> UnifiedOrder {
    id: "stripe-" + .id,
    amount: .amount / 100
  }

  // Fallback for unknown formats
  (_) -> UnifiedOrder {
    id: .id ?? generateId(),
    amount: .amount ?? 0
  }
}
```

When you `apply ToUnifiedOrder to data`, the runtime:
1. Checks if `data` matches `XeroInvoice` schema
2. If not, checks if `data` matches `StripeCharge` schema
3. If nothing matches, uses the wildcard `(_)` variant

### Using Transforms

```reqon
action NormalizeOrders {
  for order in raw_orders {
    // Automatically selects the right variant
    apply ToUnifiedOrder to order

    // Result is in 'response', can also use 'as':
    // apply ToUnifiedOrder to order as normalized

    store response -> orders { key: .id }
  }
}
```

### Transform Syntax Options

**Simple transform (single source):**
```reqon
transform Normalize: RawItem -> StandardItem {
  id: .external_id,
  name: .title
}
```

**Simple transform (any source):**
```reqon
transform Normalize -> StandardItem {
  id: .id,
  name: .name
}
```

**Overloaded transform:**
```reqon
transform ToUnified {
  (SchemaA) -> Target { ... }
  (SchemaB) -> Target { ... }
  (_) -> Target { ... }
}
```

**With guard conditions:**
```reqon
transform Selective {
  (RawItem) where .status == "active" -> Item {
    active: true
  }
  (_) -> Item {
    active: false
  }
}
```

## Running the Example

```bash
reqon run mission.reqon
```

## Benefits of This Structure

1. **Separation of Concerns**: Schemas and transforms are separate from mission logic
2. **Reusability**: Transforms can be shared across missions
3. **Testability**: Each transform can be validated independently
4. **Maintainability**: Clear organization makes updates easier
5. **Type Safety**: Schema-based matching catches errors early
