---
sidebar_position: 7
---

# Expressions

Reqon uses the Vague expression language for data manipulation. This page covers the most common expressions; for complete documentation, see the [Vague documentation](https://github.com/mcclowes/vague).

## Literals

```vague
// Numbers
42
3.14
-100

// Strings
"hello world"
'single quotes also work'

// Booleans
true
false

// Null
null

// Arrays
[1, 2, 3]
["a", "b", "c"]

// Objects
{ key: "value", nested: { a: 1 } }
```

## Property access

```vague
// Dot notation
.name
.address.city
.items[0].name

// Within context
user.name
response.data.items

// Array indexing
.items[0]
.items[length(.items) - 1]
```

## Operators

### Arithmetic

```vague
1 + 2       // 3
10 - 3      // 7
4 * 5       // 20
20 / 4      // 5
```

There's no modulo operator. The `+` operator also concatenates strings (see below).

### Comparison

```vague
.a == .b    // equality
.a != .b    // inequality
.a > .b     // greater than
.a >= .b    // greater or equal
.a < .b     // less than
.a <= .b    // less or equal
```

### Logical

```vague
.a and .b   // logical AND
.a or .b    // logical OR
not .a      // logical NOT
```

### String

The `+` operator concatenates strings (and coerces a number operand to a string). There are no string-matching operators like `contains`, `startsWith`, or `endsWith`:

```vague
.first + " " + .last    // concatenation
"id-" + .id             // number coerced to string
```

## Conditional expressions

### Ternary

The ternary operator is the only inline conditional. There's no `if/then/else` expression:

```vague
.status == "active" ? "Yes" : "No"

// Chain for multiple branches
.age >= 18 ? "Adult" : .age >= 13 ? "Teen" : "Child"
```

### Null coalescing

`or` returns its left side when truthy, otherwise the right side:

```vague
.name or "Unknown"
.email or .backup_email or "no-email@example.com"
```

## Built-in functions

The expression language ships a small, fixed set of functions. Anything not in this list isn't available.

```vague
// Collections
length([1, 2, 3])   // 3 (also works on strings)
count([1, 2, 3])    // 3
sum([1, 2, 3])      // 6 (array of numbers)
first([1, 2, 3])    // 1
last([1, 2, 3])     // 3

// Rounding
round(3.7)          // 4
floor(3.7)          // 3
ceil(3.2)           // 4

// Current time (ISO 8601 string)
now()

// Environment variable (name must be a string literal)
env("API_KEY")
```

There are no string, date, object, or higher-order array functions (no `lowercase`, `split`, `parseDate`, `map`, `filter`, `keys`, and so on). Build derived values from operators and these functions, or shape data upstream.

## Type checks

Use `is` to test a value's runtime type:

```vague
.value is string
.value is number
.value is boolean
.value is array
.value is object
.value is null
```

## Environment variables

```vague
env("API_KEY")
env("BASE_URL")
env("DEBUG") == "true"
```

The argument to `env` must be a string literal, not a dynamic expression.

## Pattern matching in expressions

A match expression compares a value against literal patterns with `=>`, using equality, and returns the matching arm's value. The `_` arm is the catch-all:

```vague
match .status {
  "active" => "Active User",
  "pending" => "Pending Approval",
  "inactive" => "Deactivated",
  _ => "Unknown Status"
}
```

This is the inline match *expression*. It's distinct from the `match` *step* (see [Match](./match)), which routes on schemas and uses `->`.

## Other expression forms

The Vague language also supports a few forms you'll see occasionally:

- `^parent` references a value in an enclosing scope.
- `a..b` is a range.
- `any of <collection> where <condition>` finds the first matching element.
- `response` always refers to the latest fetch response.

## Complex expression examples

### Data transformation

```vague
map user -> Output {
  fullName: .firstName + " " + .lastName,
  isAdult: .age >= 18,
  displayName: .nickname or .firstName
}
```

### Aggregation

```vague
map order -> Summary {
  itemCount: length(.items),
  totalRevenue: sum(.amounts),
  avgItemValue: sum(.amounts) / length(.items)
}
```

### Conditional logic

```vague
map order -> PricedOrder {
  discount: match .customerTier {
    "gold" => 0.20,
    "silver" => 0.10,
    "bronze" => 0.05,
    _ => 0
  },
  shippingFee: .total > 100 ? 0 : 9.99
}
```

### Validation conditions

```vague
validate order {
  assume .id is string,
  assume length(.items) > 0,
  assume sum(.amounts) > 0,
  assume .createdAt != null,
  assume .shippingDate == null or .shippingDate >= .createdAt
}
```

For the complete expression language reference, visit the [Vague documentation](https://github.com/mcclowes/vague).
