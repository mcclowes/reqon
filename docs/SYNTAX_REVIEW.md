# Reqon DSL Syntax Review

A comprehensive analysis of the Reqon DSL syntax focusing on **expressiveness**, **ease of use**, and **specificity**.

---

## Executive Summary

Reqon provides a well-designed declarative DSL for data synchronization pipelines. The core syntax is intuitive and maps well to the ETL domain. However, there are opportunities to improve clarity, reduce ambiguity, and add missing constructs that would enhance real-world usability.

**Overall Assessment:** 7.5/10 - Strong foundation with specific areas for refinement.

---

## Strengths

### 1. Clear Hierarchical Structure

The `mission > action > steps > run` hierarchy is immediately understandable:

```reqon
mission SyncData {
  source API { ... }
  store data: sql("table")
  action FetchData { ... }
  run FetchData
}
```

This maps directly to how developers think about ETL pipelines.

### 2. Expressive Pattern Matching

The `match` expression for status transformation is concise and readable:

```reqon
status: match .Status {
  "PAID" => "paid",
  "AUTHORISED" => "approved",
  _ => "unknown"
}
```

### 3. Natural Iteration Syntax

`for...in...where` reads like English:

```reqon
for invoice in invoices_cache where ._partial == true {
  // process
}
```

### 4. First-Class HTTP Concerns

Pagination, retry, and rate limiting are built into the language rather than being afterthoughts:

```reqon
fetch GET "/orders" {
  paginate: offset(page, 100),
  until: length(response.orders) == 0,
  retry: { maxAttempts: 5, backoff: "exponential" }
}
```

### 5. OpenAPI Integration

The `fetch Source.operationId` syntax is elegant for spec-first workflows:

```reqon
source Petstore from "./petstore.yaml" { ... }
// ...
fetch Petstore.listPets { ... }
```

---

## Issues and Recommendations

### Issue 1: Ambiguous `store` Keyword Overloading

**Problem:** `store` is used for both definition and action steps:

```reqon
store invoices: sql("invoices")           // Definition
store response -> invoices { key: .id }   // Action step
```

**Impact:** Cognitive overhead when reading code. Users must determine meaning from context.

**Recommendation:** Differentiate the constructs:
- Option A: `target invoices: sql("invoices")` for definition
- Option B: `save response -> invoices { ... }` for action step
- Option C: `persist response -> invoices { ... }` for action step

### Issue 2: Ambiguous `response` Variable Scope

**Problem:** `response` has context-dependent meaning:

```reqon
fetch GET "/invoices"
validate response { ... }     // response = fetch result

map invoice -> Schema { ... }
store response -> target      // response = map result?
```

**Impact:** Unclear what `response` refers to after multiple operations in sequence.

**Recommendation:**
- Option A: Each step produces explicitly named output: `fetch GET "/invoices" as invoices_data`
- Option B: Use `$last` or `$result` for implicit reference, keep `response` only for HTTP responses
- Option C: Require explicit naming: `fetch GET "/invoices" into raw_invoices`

### Issue 3: No Parallel Execution Syntax

**Problem:** `run A then B then C` is always sequential. No way to express:
- "Run A and B concurrently, then C after both complete"
- "Run A, B, C all in parallel"

**Impact:** Can't optimize pipelines that have independent data sources.

**Recommendation:** Add parallel execution syntax:

```reqon
// Option A: Explicit parallel keyword
run SyncShopify parallel SyncStripe
  then ValidateAll

// Option B: Grouping syntax
run [SyncShopify, SyncStripe, SyncShipStation]
  then ValidateAll

// Option C: Named dependencies
run SyncShopify, SyncStripe, SyncShipStation
  then ValidateAll after all
```

### Issue 4: Missing Conditional Pipeline Execution

**Problem:** Can't express conditional action execution:

```reqon
// Not currently possible:
run FetchIncrementalIfExists else FetchFullSync
  then Normalize
```

**Impact:** Common pattern of "full sync vs incremental" requires workarounds.

**Recommendation:** Add conditional execution:

```reqon
run FetchIncremental if sync_state.exists("last_sync")
    else FetchFull
  then Normalize

// Or inline conditions:
run FetchData
  then ValidateData if settings.validation_enabled
  then StoreData
```

### Issue 5: Schema Types Too Limited

**Problem:** Only primitives (`string`, `int`, `decimal`, `date`, `boolean`). Missing:
- Arrays: `tags: [string]`
- Optional: `nickname: string?`
- Nested objects: `address: Address`
- Enums: `status: "pending" | "active" | "closed"`

**Impact:** Can't accurately model real-world data structures.

**Recommendation:** Extend type system:

```reqon
schema Order {
  id: string,
  items: [LineItem],           // Array of schema
  shipping_address: Address?,  // Optional nested schema
  status: "pending" | "shipped" | "delivered",  // Union/enum
  metadata: map<string, string>  // Key-value map
}
```

### Issue 6: No Reusable Components

**Problem:** Can't define reusable transformations or validation rules:

```reqon
// Same validation repeated in multiple actions
validate response { assume .amount >= 0 }
validate response { assume .amount >= 0 }  // duplication
```

**Impact:** Code duplication, inconsistent validation across actions.

**Recommendation:** Add reusable constructs:

```reqon
// Reusable validation rules
rule PositiveAmount {
  assume .amount >= 0,
  assume .amount < 1000000
}

// Reusable transformation
transform CentsToDecimal(field) {
  field / 100
}

// Usage
validate response using PositiveAmount
amount: CentsToDecimal(.amount_cents)
```

### Issue 7: Inconsistent Expression Syntax in Examples

**Problem:** Examples show constructs not clearly defined in the parser:

```reqon
let payment_exists = any of payments where .order_id == order.order_id
let total_paid = sum(matching_payments.amount)
let order = first(orders where .order_id == payment.order_id)
```

**Impact:** Unclear what's implemented vs. aspirational. `any of`, `first()`, `sum()` need formal definition.

**Recommendation:**
- Document all available functions/operators in formal grammar
- Implement missing constructs or remove from examples
- Consider explicit aggregate syntax:

```reqon
let payment_exists = payments.any { .order_id == order.order_id }
let total_paid = matching_payments.sum(.amount)
let order = orders.first { .order_id == payment.order_id }
```

### Issue 8: Pagination Config Not Intuitive

**Problem:** Pagination requires memorizing parameter order:

```reqon
paginate: cursor(cursor, 20, "nextCursor")
// What's the second param? Third? Not obvious.
```

**Impact:** Users must check documentation for every pagination config.

**Recommendation:** Use named parameters:

```reqon
paginate: cursor {
  param: "cursor",
  pageSize: 20,
  nextPath: "nextCursor"
}

// Or shorthand with clear naming:
paginate: cursor(param: "cursor", size: 20, next: "nextCursor")
```

### Issue 9: String Interpolation Not Formalized

**Problem:** `"${SHOPIFY_TOKEN}"` appears in examples but isn't part of the lexer/parser:

```reqon
headers: { "X-Shopify-Access-Token": "${SHOPIFY_TOKEN}" }
```

**Impact:** Unclear when/how environment variables are resolved.

**Recommendation:**
- Option A: Formalize `env()` function: `headers: { "X-Token": env("SHOPIFY_TOKEN") }`
- Option B: Add template literal token type with `${...}` interpolation
- Option C: Add dedicated `secret` type: `token: secret("SHOPIFY_TOKEN")`

### Issue 10: No Error Recovery/Handling Beyond `validate...or`

**Problem:** Only validation failures have recovery paths. What about:
- Network errors during fetch?
- Partial batch failures?
- Rate limit exhaustion?

**Impact:** Real pipelines need comprehensive error handling.

**Recommendation:** Add error handling constructs:

```reqon
action FetchWithFallback {
  fetch GET "/primary-endpoint"
    on error {
      fetch GET "/fallback-endpoint"
    }

  // Or for batches:
  for item in items {
    // ...
  } on item_error {
    store failed_item -> error_queue
    continue  // or: skip, retry, abort
  }
}
```

### Issue 11: Missing Data Filtering at Source Level

**Problem:** Can't specify query parameters cleanly without using `body`:

```reqon
fetch GET "/orders" {
  body: {
    "status": "pending",
    "created_after": "2024-01-01"
  }
}
```

**Impact:** `body` is semantically wrong for GET requests. These are query parameters.

**Recommendation:** Add explicit `params` or `query` option:

```reqon
fetch GET "/orders" {
  query: {
    status: "pending",
    created_after: "2024-01-01"
  }
}
```

### Issue 12: Validation Severity Not Exposed in Syntax

**Problem:** Parser supports `severity` on constraints, but syntax doesn't expose it:

```reqon
validate response {
  assume .amount >= 0  // What severity? No way to specify.
}
```

**Recommendation:** Allow severity specification:

```reqon
validate response {
  assume .amount >= 0 severity: error,
  assume .description != "" severity: warning
}
```

---

## Minor Suggestions

### 1. Comments in More Places
Currently `//` comments work at top level. Ensure they work inside all blocks.

### 2. Multi-line Strings
For complex query parameters or bodies, support multi-line strings:
```reqon
body: """
  {
    "query": "complex graphql query",
    "variables": {}
  }
"""
```

### 3. Import/Module System
Allow splitting large missions across files:
```reqon
import { CommonSchemas } from "./schemas.reqon"
import { ShopifySource } from "./sources/shopify.reqon"
```

### 4. Type Annotations on Variables
```reqon
let orders: [Order] = fetch GET "/orders"
```

### 5. Default Values in Schemas
```reqon
schema Order {
  status: string = "pending",
  priority: int = 0
}
```

---

## Comparison Matrix

| Feature | Current State | Recommendation |
|---------|---------------|----------------|
| Pipeline hierarchy | ✅ Excellent | - |
| Pattern matching | ✅ Excellent | - |
| Iteration syntax | ✅ Good | - |
| HTTP primitives | ✅ Good | Add `query:` for GET params |
| `store` clarity | ⚠️ Ambiguous | Differentiate definition vs step |
| `response` scope | ⚠️ Ambiguous | Add explicit output naming |
| Parallel execution | ❌ Missing | Add parallel syntax |
| Conditional execution | ❌ Missing | Add `if` in pipeline |
| Type system | ⚠️ Limited | Add arrays, optionals, nested |
| Reusability | ❌ Missing | Add rules/transforms |
| Error handling | ⚠️ Limited | Add `on error` blocks |
| Aggregate functions | ⚠️ Undocumented | Formalize `any`, `sum`, `first` |

---

## Conclusion

Reqon's syntax successfully captures the essence of data synchronization pipelines in a readable, declarative format. The main areas for improvement are:

1. **Clarity**: Disambiguate `store` and `response` semantics
2. **Completeness**: Add parallel execution, conditional pipelines, richer types
3. **Robustness**: Formalize error handling beyond validation
4. **Reusability**: Enable shared rules and transformations

These improvements would elevate Reqon from a capable DSL to a production-ready language for complex data orchestration.
