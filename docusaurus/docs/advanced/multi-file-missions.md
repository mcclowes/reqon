---
sidebar_position: 1
---

# Multi-File Missions

For complex missions, organize your code across multiple files in a folder structure.

## Folder Structure

```
missions/
└── customer-sync/
    ├── mission.reqon      # Main mission definition
    ├── actions/
    │   ├── fetch.reqon    # Fetch actions
    │   ├── transform.reqon
    │   └── export.reqon
    └── schemas/
        └── customer.reqon
```

## Main Mission File

The `mission.reqon` file defines the mission structure:

```reqon
// mission.reqon
mission CustomerSync {
  source API {
    auth: oauth2,
    base: "https://api.example.com"
  }

  store rawCustomers: memory("raw")
  store customers: file("customers")
  store errors: file("errors")

  // Actions are loaded from actions/*.reqon
  // Schemas are loaded from schemas/*.reqon

  run FetchCustomers then TransformCustomers then ExportCustomers
}
```

## Action Files

### actions/fetch.reqon

```reqon
action FetchCustomers {
  get "/customers" {
    paginate: offset(offset, 100),
    until: length(response.data) == 0,
    since: lastSync
  }

  store response.data -> rawCustomers { key: .id }
}
```

### actions/transform.reqon

```reqon
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

### actions/export.reqon

```reqon
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

## Schema Files

### schemas/customer.reqon

```reqon
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

## Running Multi-File Missions

### Run the Folder

```bash
reqon ./missions/customer-sync/
```

### Run with Options

```bash
reqon ./missions/customer-sync/ --auth ./credentials.json --verbose
```

## File Loading Order

1. `mission.reqon` (required)
2. `schemas/*.reqon` (loaded first)
3. `actions/*.reqon` (loaded after schemas)

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
│       └── common.reqon
├── customer-sync/
│   └── mission.reqon (imports shared)
└── order-sync/
    └── mission.reqon (imports shared)
```

## Best Practices

### Naming Conventions

```
actions/
├── fetch-customers.reqon     # Verb-noun
├── transform-customers.reqon
└── export-customers.reqon
```

### One Action Per File

```reqon
// actions/fetch-customers.reqon
action FetchCustomers {
  // Single responsibility
}
```

### Group Related Schemas

```reqon
// schemas/customer.reqon
schema RawCustomer { ... }
schema StandardCustomer { ... }
schema CustomerError { ... }
```

### Document with Comments

```reqon
// actions/fetch-customers.reqon

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

Ensure `mission.reqon` exists in the folder:

```bash
ls ./missions/customer-sync/mission.reqon
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
