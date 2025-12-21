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

## Property Access

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
10 % 3      // 1 (modulo)
```

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

```vague
.first + " " + .last    // concatenation
.email contains "@"     // contains check
.name startsWith "Dr."  // prefix check
.file endsWith ".pdf"   // suffix check
```

## Conditional Expressions

### If-Then-Else

```vague
if .active then "Active" else "Inactive"

if .age >= 18 then "Adult"
else if .age >= 13 then "Teen"
else "Child"
```

### Ternary Style

```vague
.status == "active" ? "Yes" : "No"
```

### Null Coalescing

```vague
.name or "Unknown"
.email or .backup_email or "no-email@example.com"
```

## String Functions

```vague
// Length
length("hello")  // 5

// Case conversion
lowercase("HELLO")  // "hello"
uppercase("hello")  // "HELLO"

// Substring
substring("hello", 0, 2)  // "he"
substring("hello", 2)     // "llo"

// Split and join
split("a,b,c", ",")       // ["a", "b", "c"]
join(["a", "b"], "-")     // "a-b"

// Trim
trim("  hello  ")         // "hello"
trimStart("  hello")      // "hello"
trimEnd("hello  ")        // "hello"

// Replace
replace("hello", "l", "L")  // "heLLo"

// Concatenation
concat("Hello", " ", "World")  // "Hello World"
```

## Array Functions

```vague
// Length
length([1, 2, 3])  // 3

// Access
first([1, 2, 3])   // 1
last([1, 2, 3])    // 3

// Check contents
includes([1, 2, 3], 2)  // true
isEmpty([])             // true

// Transform
map([1, 2, 3], x => x * 2)      // [2, 4, 6]
filter([1, 2, 3], x => x > 1)   // [2, 3]
reduce([1, 2, 3], (a, b) => a + b, 0)  // 6

// Aggregate
sum([1, 2, 3])      // 6
min([1, 2, 3])      // 1
max([1, 2, 3])      // 3
avg([1, 2, 3])      // 2

// Combine
concat([1, 2], [3, 4])   // [1, 2, 3, 4]
flatten([[1, 2], [3]])   // [1, 2, 3]
unique([1, 1, 2, 2])     // [1, 2]

// Sort
sort([3, 1, 2])          // [1, 2, 3]
sortBy(items, .name)     // sorted by name field

// Find
find(items, .id == "123")   // first match
findIndex(items, .id == "123")  // index of first match
```

## Object Functions

```vague
// Get keys/values
keys({ a: 1, b: 2 })     // ["a", "b"]
values({ a: 1, b: 2 })   // [1, 2]
entries({ a: 1 })        // [["a", 1]]

// Check
hasKey({ a: 1 }, "a")    // true

// Transform
pick({ a: 1, b: 2 }, ["a"])        // { a: 1 }
omit({ a: 1, b: 2 }, ["b"])        // { a: 1 }
merge({ a: 1 }, { b: 2 })          // { a: 1, b: 2 }
```

## Numeric Functions

```vague
// Rounding
round(3.7)        // 4
round(3.14159, 2) // 3.14
floor(3.7)        // 3
ceil(3.2)         // 4

// Math
abs(-5)           // 5
min(1, 2, 3)      // 1
max(1, 2, 3)      // 3
pow(2, 3)         // 8
sqrt(16)          // 4

// Conversion
toNumber("42")    // 42
toString(42)      // "42"
```

## Date Functions

```vague
// Current time
now()

// Parsing
parseDate("2024-01-20")
parseDate("2024-01-20T10:30:00Z")

// Formatting
formatDate(now(), "YYYY-MM-DD")
formatDate(now(), "MMM D, YYYY")

// Components
year(now())       // 2024
month(now())      // 1-12
day(now())        // 1-31
hour(now())       // 0-23
minute(now())     // 0-59

// Manipulation
addDays(now(), 7)
addMonths(now(), 1)
subtractDays(now(), 30)

// Comparison
diffDays(date1, date2)
isBefore(date1, date2)
isAfter(date1, date2)
```

## Type Functions

```vague
// Type checking
.value is string
.value is number
.value is boolean
.value is array
.value is object
.value is null

// Type conversion
toString(123)       // "123"
toNumber("42")      // 42
toBoolean(1)        // true
toArray("a")        // ["a"]
```

## Environment Variables

```vague
env("API_KEY")
env("BASE_URL")
env("DEBUG") == "true"
```

## Pattern Matching in Expressions

```vague
match .status {
  "active" => "Active User",
  "pending" => "Pending Approval",
  "inactive" => "Deactivated",
  _ => "Unknown Status"
}
```

## Complex Expression Examples

### Data Transformation

```vague
map user -> Output {
  fullName: concat(.firstName, " ", .lastName),
  email: lowercase(.email),
  age: year(now()) - year(.birthDate),
  isAdult: year(now()) - year(.birthDate) >= 18,
  displayName: if .nickname then .nickname else .firstName,
  initials: concat(
    substring(.firstName, 0, 1),
    substring(.lastName, 0, 1)
  )
}
```

### Aggregation

```vague
map orders -> Summary {
  totalOrders: length(orders),
  totalRevenue: sum(orders.map(.total)),
  avgOrderValue: sum(orders.map(.total)) / length(orders),
  maxOrder: max(orders.map(.total)),
  pendingCount: length(filter(orders, .status == "pending")),
  completedRate: length(filter(orders, .status == "completed")) / length(orders) * 100
}
```

### Conditional Logic

```vague
map order -> PricedOrder {
  ...order,
  discount: match .customerTier {
    "gold" => 0.20,
    "silver" => 0.10,
    "bronze" => 0.05,
    _ => 0
  },
  discountedTotal: .total * (1 - match .customerTier {
    "gold" => 0.20,
    "silver" => 0.10,
    "bronze" => 0.05,
    _ => 0
  }),
  shippingFee: if .total > 100 then 0 else 9.99,
  finalTotal: .total * (1 - if .customerTier == "gold" then 0.20 else 0) +
              (if .total > 100 then 0 else 9.99)
}
```

### Validation Conditions

```vague
validate order {
  assume .id is string,
  assume length(.items) > 0,
  assume sum(.items.map(.quantity)) > 0,
  assume .total == sum(.items.map(.price * .quantity)),
  assume .createdAt <= now(),
  assume .shippingDate == null or .shippingDate >= .createdAt
}
```

For the complete expression language reference, visit the [Vague documentation](https://github.com/mcclowes/vague).
