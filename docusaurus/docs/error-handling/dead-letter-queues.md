---
sidebar_position: 3
---

# Dead letter queues

A dead letter queue (DLQ) is just a store you send failed values to for later review. It prevents data loss when something goes wrong and gives you a record you can inspect or reprocess.

## Basic usage

The `queue` flow directive stashes the matched value into a named store. Here, an action queues responses the API flagged as errors and stores the rest:

```vague
mission DataSync {
  store data: file("data")
  store dlq: file("dead-letter-queue")

  action FetchData {
    get "/items"

    match response {
      ApiError -> queue dlq,
      _ -> store response -> data { key: .id }
    }
  }

  run FetchData
}
```

## Queue directive syntax

```vague
queue storeName
```

`queue` takes a store name and stashes the current matched value — there's no payload or options block. The value is keyed by its own `id` field, or by an auto-generated `queued-N` key when it has none. `queue` with no store name discards the value, so always name a target.

## Shaping what gets queued

Because `queue` stashes the matched value as-is, build the record you want first with `let`, then match over it. Include an `id` so the entry gets a stable key:

```vague
action FetchData {
  get "/items"

  for item in response.items {
    get concat("/items/", item.id, "/details")

    let entry = {
      id: item.id,
      error: response,
      timestamp: now()
    }

    match entry {
      _ -> queue dlq
    }
  }
}
```

To queue only on failure, branch before building the entry:

```vague
match response {
  ApiError -> {
    let entry = { id: item.id, error: response, timestamp: now() }
    match entry {
      _ -> queue dlq
    }
  },
  _ -> store response -> data { key: item.id }
}
```

## Categorized queues

Send different cases to different stores:

```vague
mission Categorized {
  store retryable: file("retryable-errors")
  store permanent: file("permanent-errors")

  action Process {
    for item in items {
      get concat("/api/", item.id)

      match response {
        // Transient problems the API reports in the body
        Retryable -> queue retryable,

        // Permanent problems
        Rejected -> queue permanent,

        // Success
        _ -> continue
      }
    }
  }
}
```

`Retryable` and `Rejected` are schemas you define to match the shapes the API returns. See [Schemas](../core-concepts/schemas) for how schema matching works.

## Processing a DLQ

### Manual review

Export the stores to JSON and review them:

```bash
reqon mission.reqon --output ./exports.json
# exports.json contains one entry per store, keyed by store name
```

`--output` writes a single combined JSON file keyed by store name, so the dead-letter queue's contents appear under its store name.

### Reprocessing in a separate mission

Run a follow-up mission that reads the queued entries and re-fetches them. Store results with `upsert` so reprocessing is idempotent:

```vague
mission RetryFailed {
  store data: file("data")

  action RetryItems {
    for entry in failedEntries {
      get concat("/api/", entry.id)
      store response -> data { key: entry.id, upsert: true }
    }
  }

  run RetryItems
}
```

### Scheduled reprocessing

```vague
mission ScheduledRetry {
  schedule: every 1 hours

  store data: file("data")

  action RetryEligible {
    for entry in failedEntries {
      get concat("/api/", entry.id)
      store response -> data { key: entry.id, upsert: true }
    }
  }

  run RetryEligible
}
```

## Best practices

### Include enough context

Queue an entry that records what failed and when, so you can act on it later without guessing:

```vague
let entry = {
  id: item.id,
  originalData: item,
  error: response,
  timestamp: now()
}

match entry {
  _ -> queue dlq
}
```

### Separate retryable from permanent

Use different stores so reprocessing can target only the entries worth retrying:

```vague
match response {
  Retryable -> queue retryQueue,
  Rejected -> queue permanentQueue,
  _ -> continue
}
```

### Make reprocessing idempotent

Use `upsert` when re-storing so a re-run doesn't create duplicates:

```vague
store response -> data { key: item.id, upsert: true }
```

## Troubleshooting

### Queue growing too fast

1. Check for systemic issues
2. Review the queued entries for a common error
3. Fix the root cause before reprocessing

### Entries missing keys

A queued value with no `id` field gets an auto-generated `queued-N` key, which makes targeted reprocessing harder. Include an `id` in the value you queue so each entry has a stable key.
