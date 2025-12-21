---
sidebar_position: 1
---

# Multi-file missions

For complex missions, organize your code across multiple files in a folder structure.

## Folder structure

```
missions/
└── customer-sync/
    ├── mission.vague      # Main mission definition
    ├── actions/
    │   ├── fetch.vague    # Fetch actions
    │   ├── transform.vague
    │   └── export.vague
    └── schemas/
        └── customer.vague
```

## Main mission file

The `mission.vague` file defines the mission structure:

```vague
// mission.vague
mission CustomerSync {
  source API {
    auth: oauth2,
    base: "https://api.example.com"
  }

  store rawCustomers: memory("raw")
  store customers: file("customers")
  store errors: file("errors")

  // Actions are loaded from actions/*.vague
  // Schemas are loaded from schemas/*.vague

  run FetchCustomers then TransformCustomers then ExportCustomers
}
```

## Action files

### actions/fetch.vague

```vague
action FetchCustomers {
  get "/customers" {
    paginate: offset(offset, 100),
    until: length(response.data) == 0,
    since: lastSync
  }

  store response.data -> rawCustomers { key: .id }
}
```

### actions/transform.vague

```vague
action TransformCustomers {
  for customer in rawCustomers {
    validate customer {
      assume .id is string,
      assume .email is string
    }

    map customer -> StandardCustomer {
      id: .id,
      name: concat(.firstName, " ", .lastName),
      email: lowercase(.email),
      createdAt: parseDate(.created_at)
    }

    store customer -> customers { key: .id, upsert: true }
  }
}
```

### actions/export.vague

```vague
action ExportCustomers {
  for customer in customers where .updatedAt > lastExport {
    post ExportAPI "/customers" {
      body: customer
    }

    match response {
      { error: e } -> queue errors { item: { id: customer.id, error: e } },
      _ -> continue
    }
  }
}
```

## Schema files

### schemas/customer.vague

```vague
schema RawCustomer {
  id: string,
  firstName: string,
  lastName: string,
  email: string,
  created_at: string
}

schema StandardCustomer {
  id: string,
  name: string,
  email: string,
  createdAt: date
}

schema ExportError {
  id: string,
  error: string,
  timestamp: date
}
```

## Running multi-file missions

### Run the folder

```bash
reqon ./missions/customer-sync/
```

### Run with options

```bash
reqon ./missions/customer-sync/ --auth ./credentials.json --verbose
```

## File loading order

1. `mission.vague` (required)
2. `schemas/*.vague` (loaded first)
3. `actions/*.vague` (loaded after schemas)

## Benefits

### Organization

| Single File | Multi-File |
|-------------|------------|
| All code in one file | Logical separation |
| Hard to navigate | Easy to find code |
| Merge conflicts | Independent editing |

### Maintainability

- Each file has single responsibility
- Easier code reviews
- Better version control

### Reusability

```
missions/
├── shared/
│   └── schemas/
│       └── common.vague
├── customer-sync/
│   └── mission.vague (imports shared)
└── order-sync/
    └── mission.vague (imports shared)
```

## Best practices

### Naming conventions

```
actions/
├── fetch-customers.vague     # Verb-noun
├── transform-customers.vague
└── export-customers.vague
```

### One action per file

```vague
// actions/fetch-customers.vague
action FetchCustomers {
  // Single responsibility
}
```

### Group related schemas

```vague
// schemas/customer.vague
schema RawCustomer { ... }
schema StandardCustomer { ... }
schema CustomerError { ... }
```

### Document with comments

```vague
// actions/fetch-customers.vague

// FetchCustomers retrieves customer data from the API
// Uses pagination and incremental sync for efficiency
action FetchCustomers {
  // Fetch with pagination
  get "/customers" {
    paginate: offset(offset, 100),
    until: length(response.data) == 0,
    since: lastSync
  }

  // Store raw data for processing
  store response.data -> rawCustomers { key: .id }
}
```

## Troubleshooting

### "Mission not found"

Ensure `mission.vague` exists in the folder:

```bash
ls ./missions/customer-sync/mission.vague
```

### "Action not found"

Check action file is in `actions/` folder:

```bash
ls ./missions/customer-sync/actions/
```

### "Schema not found"

Check schema file is in `schemas/` folder:

```bash
ls ./missions/customer-sync/schemas/
```
