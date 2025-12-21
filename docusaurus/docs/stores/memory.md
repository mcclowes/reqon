---
sidebar_position: 2
---

# Memory Store

The memory store uses an in-memory hash map. Data is lost when the process ends.

## Configuration

```vague
store cache: memory("cache")
store tempData: memory("temp-processing")
```

## Use Cases

### Testing

```vague
mission TestSync {
  store testData: memory("test")

  action Test {
    get "/test-data"
    store response -> testData { key: .id }
  }
}
```

### Temporary Processing

```vague
mission Transform {
  store raw: memory("raw")
  store processed: file("processed")

  action FetchRaw {
    get "/items"
    store response -> raw { key: .id }
  }

  action Process {
    for item in raw {
      map item -> Processed { /* ... */ }
      store item -> processed { key: .id }
    }
  }

  run FetchRaw then Process
}
```

### Caching

```vague
mission CachedLookup {
  store lookupCache: memory("lookup-cache")

  action Fetch {
    for id in idsToFetch {
      // Check cache first
      match lookupCache {
        _ where lookupCache[id] != null -> continue,
        _ -> {
          get concat("/items/", id)
          store response -> lookupCache { key: id }
        }
      }
    }
  }
}
```

### Intermediate Results

```vague
mission Pipeline {
  store step1: memory("step1")
  store step2: memory("step2")
  store final: file("results")

  action Step1 {
    get "/source-data"
    store response -> step1 { key: .id }
  }

  action Step2 {
    for item in step1 {
      map item -> Enriched { /* ... */ }
      store item -> step2 { key: .id }
    }
  }

  action Step3 {
    for item in step2 {
      validate item { /* ... */ }
      store item -> final { key: .id }
    }
  }

  run Step1 then Step2 then Step3
}
```

## Characteristics

### Speed

Memory stores are the fastest option:
- O(1) read/write by key
- No I/O overhead
- No serialization

### Size Limits

Limited by available memory:
- Suitable for thousands to millions of small records
- Large objects may cause memory issues
- Monitor memory usage for large datasets

### Durability

Data is not persisted:
- Lost on process exit
- Lost on errors/crashes
- Not suitable for critical data

## Best Practices

### Use for Temporary Data

```vague
// Good: temporary processing
store temp: memory("temp")

// Not recommended: critical data
store customers: memory("customers")  // Use file or sql instead
```

### Combine with Persistent Stores

```vague
mission Hybrid {
  store cache: memory("cache")
  store persistent: file("data")

  action Process {
    // Use memory for working data
    get "/items"
    store response -> cache { key: .id }

    // Process and save to persistent
    for item in cache {
      map item -> Processed { /* ... */ }
      store item -> persistent { key: .id }
    }
  }
}
```

### Clear When Done

Memory is automatically released when mission ends, but you can clear explicitly:

```vague
action CleanUp {
  // Clear temporary data
  clear cache
}
```

## Programmatic Access

```typescript
import { execute } from 'reqon';

const result = await execute(source);

// Access memory store
const cache = result.stores.get('cache');
const items = await cache.list();
const item = await cache.get('key');
```

## Comparison with Other Stores

| Feature | Memory | File | SQL |
|---------|--------|------|-----|
| Speed | Fastest | Fast | Medium |
| Persistence | No | Yes | Yes |
| Scalability | Limited | Limited | High |
| Use Case | Testing, temp | Development | Production |
