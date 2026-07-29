---
sidebar_position: 1
---

# Multi-file missions

For larger missions, you can split your actions across several files in a single folder.

## Folder structure

The folder is flat. A root file named `mission.vague` defines the mission, and every other `.vague` file in the same folder contributes action definitions:

```
customer-sync/
├── mission.vague      # Root: sources, stores, schemas, pipeline
├── fetch.vague        # action FetchCustomers
├── transform.vague    # action TransformCustomers
└── export.vague       # action ExportCustomers
```

There are no `actions/` or `schemas/` subdirectories. The loader reads the folder's top level only, so action files must sit alongside `mission.vague`.

## Root file

The root must be named `mission.vague` (or `mission.reqon`). It holds the sources, stores, schemas, and pipeline. Schemas live here too — they aren't loaded from other files.

```vague
// mission.vague
mission CustomerSync {
  source API {
    auth: oauth2,
    base: "https://api.example.com"
  }

  source ExportAPI {
    auth: bearer,
    base: "https://export.example.com"
  }

  store rawCustomers: memory("raw")
  store customers: file("customers")

  schema StandardCustomer {
    id: string,
    name: string,
    email: string
  }

  // Actions are merged from the other .vague files in this folder

  run FetchCustomers then TransformCustomers then ExportCustomers
}
```

## Action files

Each action file contains one or more `action` definitions and nothing else. A file that defines a `mission` is rejected.

### fetch.vague

```vague
action FetchCustomers {
  get "/customers" {
    source: API,
    paginate: offset(offset, 100),
    until: length(response.data) == 0,
    since: lastSync
  }

  store response.data -> rawCustomers { key: .id }
}
```

### transform.vague

```vague
action TransformCustomers {
  for customer in rawCustomers {
    validate customer {
      assume .id is string
      assume .email is string
    }

    map customer -> StandardCustomer {
      id: .id,
      name: concat(.firstName, " ", .lastName),
      email: lowercase(.email)
    }

    store customer -> customers { key: .id, upsert: true }
  }
}
```

### export.vague

```vague
action ExportCustomers {
  for customer in customers where .updatedAt > lastExport {
    post "/customers" {
      source: ExportAPI,
      body: customer
    }

    store response -> exported { key: .id }
  }
}
```

## Running multi-file missions

Point the CLI at the folder:

```bash
reqon ./customer-sync/
```

With options:

```bash
reqon ./customer-sync/ --auth ./credentials.json --verbose
```

## How loading works

1. The loader finds `mission.vague` (the root file) and parses the mission.
2. It reads every other `.vague` file in the same folder and extracts their `action` definitions.
3. Those actions are merged into the mission. Action names must be unique across all files.
4. Reqon validates that every action referenced in the pipeline exists.

Only action definitions are merged from the extra files. Sources, stores, and schemas must be declared in the root file.

## Benefits

| Single file | Multi-file |
|-------------|------------|
| All code in one file | One action per file |
| Harder to navigate | Easy to find an action |
| Larger merge conflicts | Independent editing |

## Best practices

### One action per file

```vague
// fetch-customers.vague
action FetchCustomers {
  // Single responsibility
}
```

### Name files after their action

```
fetch-customers.vague     # action FetchCustomers
transform-customers.vague # action TransformCustomers
export-customers.vague    # action ExportCustomers
```

### Document with comments

```vague
// fetch-customers.vague

// FetchCustomers retrieves customer data from the API.
// Uses pagination and incremental sync.
action FetchCustomers {
  get "/customers" {
    source: API,
    paginate: offset(offset, 100),
    until: length(response.data) == 0,
    since: lastSync
  }

  store response.data -> rawCustomers { key: .id }
}
```

## Troubleshooting

### "Mission folder must contain a root file"

The folder needs a file named exactly `mission.vague` (or `mission.reqon`):

```bash
ls ./customer-sync/mission.vague
```

### "Action file should not contain a mission definition"

Only the root file defines the `mission`. Action files can contain `action` definitions only.

### "Duplicate action definition"

An action with the same name is defined in two files. Action names must be unique across the whole folder.
