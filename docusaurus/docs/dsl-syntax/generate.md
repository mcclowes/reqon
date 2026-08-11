---
sidebar_position: 4
---

# Generate data

Generate fixture data from a Vague schema inside an action:

```vague
mission SeedCustomers {
  schema Customer {
    id: unique string,
    score: int in 1..100,
    status: "active" | "paused"
  }

  store customers: memory("customers")

  action Seed {
    generate 100 of Customer as generated { seed: 42 }

    for customer in generated {
      store customer -> customers { key: .id }
    }
  }

  run Seed
}
```

The generated array is bound to the name after `as` and becomes `response` for
the next step. The optional numeric seed makes repeated runs produce the same
records. Vague enforces schema ranges, choices, uniqueness, assumptions, and
invariants while generating.

Generation is useful for integration-test request bodies, local store seeding,
and reproducible failure cases. Keep generated fixtures separate from production
data when producing Vague synthetic-data reports.
