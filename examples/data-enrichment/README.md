# Data Enrichment Example

Demonstrates Reqon's data transformation capabilities with let bindings and spread operator.

## Key Features

| Feature | Description |
|---------|-------------|
| `let` bindings | Variable assignment for computed values |
| `...` spread | Merge objects, preserving original data |
| Complex `match` | Multi-condition pattern matching |
| Derived fields | Compute new fields from existing data |
| Multi-source enrichment | Combine data from multiple APIs |

## Let Bindings

Assign computed values to variables for reuse:

```vague
let total_orders = response.metrics.order_count
let avg_order_value = total_revenue / max(total_orders, 1)

// Use in expressions
let monthly_value = avg_order_value * purchase_frequency

// Use in match expressions
let tier = match score {
  s where s >= 800 => "excellent",
  s where s >= 700 => "good",
  _ => "standard"
}
```

### Chained Computations
```vague
let a = response.value
let b = a * 2
let c = b + 10
let result = c / 100
```

## Spread Operator

Merge objects while adding or overriding fields:

```vague
// Add new field to existing object
store {
  ...customer,
  geo_data: {
    latitude: response.lat,
    longitude: response.lng
  }
} -> customers { key: customer.id }
```

### Nested Spread
```vague
store {
  ...customer,
  analytics: {
    ...customer.analytics,
    rfm_score: computed_rfm
  }
} -> customers { key: customer.id }
```

### Override Fields
```vague
// Later fields override earlier ones
store {
  ...original,
  status: "enriched",
  updated_at: now()
} -> data { key: .id }
```

## Complex Match Expressions

### Multi-Condition Matching
```vague
let segment = match {
  ltv > 10000 and risk == "low" and active => "vip",
  ltv > 10000 and inactive => "vip_at_risk",
  ltv > 2000 and growing => "growth",
  _ => "standard"
}
```

### Match with Computed Guards
```vague
let tier = match score {
  s where s >= 800 => "excellent",
  s where s >= 700 => "good",
  s where s >= 600 => "fair",
  _ => "poor"
}
```

### Match with In Operator
```vague
match risk_tier {
  t where t in ["excellent", "good"] => high_limit,
  t where t in ["fair"] => medium_limit,
  _ => low_limit
}
```

## Enrichment Patterns

### Sequential Enrichment
```vague
// Each step adds to the customer object
action Step1 {
  store { ...customer, field1: data1 } -> store
}
action Step2 {
  store { ...customer, field2: data2 } -> store
}
```

### Parallel Enrichment
```vague
// Fetch from multiple sources simultaneously
run [EnrichFromA, EnrichFromB, EnrichFromC]
  then MergeResults
```

### Conditional Enrichment
```vague
for customer in customers where .needs_geo == true {
  // Only enrich customers that need it
}
```

## Usage

```bash
# Run enrichment pipeline
node dist/cli.js examples/data-enrichment/enrichment.vague --verbose

# With credentials
node dist/cli.js examples/data-enrichment/enrichment.vague --auth credentials.json
```

## Best Practices

1. **Use let for clarity**: Break complex expressions into named steps
2. **Spread preserves data**: Use `...obj` to avoid losing fields
3. **Compute once, use many**: Store computed values in let bindings
4. **Validate enrichments**: Check for null/missing data before using
5. **Track errors**: Log failed enrichments for retry
6. **Parallel when possible**: Independent enrichments can run concurrently
