---
sidebar_position: 2
---

# Pagination

Reqon provides built-in support for the three most common pagination strategies: offset-based, page number-based, and cursor-based.

## Pagination Strategies

### Offset-Based Pagination

Uses an offset value that increments by page size:

```reqon
get "/users" {
  paginate: offset(offset, 100),
  until: length(response.data) == 0
}
```

How it works:
- First request: `?offset=0`
- Second request: `?offset=100`
- Third request: `?offset=200`
- ...continues until `until` condition is true

Parameters:
- `offset` - Query parameter name for the offset value
- `100` - Page size (items per request)

### Page Number-Based Pagination

Uses a page number starting from 1:

```reqon
get "/users" {
  paginate: page(page, 50),
  until: response.meta.hasNext == false
}
```

How it works:
- First request: `?page=1`
- Second request: `?page=2`
- Third request: `?page=3`
- ...continues until `until` condition is true

Parameters:
- `page` - Query parameter name
- `50` - Page size

### Cursor-Based Pagination

Uses a cursor token from the previous response:

```reqon
get "/users" {
  paginate: cursor(cursor, 100, "meta.nextCursor"),
  until: response.meta.nextCursor == null
}
```

How it works:
- First request: no cursor parameter
- Response: `{ data: [...], meta: { nextCursor: "abc123" } }`
- Second request: `?cursor=abc123`
- ...continues until cursor is null

Parameters:
- `cursor` - Query parameter name
- `100` - Page size
- `"meta.nextCursor"` - Path to next cursor in response

## Termination Conditions

The `until` option specifies when to stop paginating:

### Empty Response

```reqon
get "/items" {
  paginate: offset(skip, 100),
  until: length(response) == 0
}
```

### Empty Data Array

```reqon
get "/items" {
  paginate: offset(skip, 100),
  until: length(response.data) == 0
}
```

### Boolean Flag

```reqon
get "/items" {
  paginate: page(p, 50),
  until: response.hasMore == false
}

// Or
get "/items" {
  paginate: page(p, 50),
  until: response.pagination.hasNext == false
}
```

### Null Cursor

```reqon
get "/items" {
  paginate: cursor(after, 100, "cursor.next"),
  until: response.cursor.next == null
}
```

### Maximum Pages

```reqon
get "/items" {
  paginate: page(p, 100),
  until: length(response.items) == 0 or p > 10
}
```

### Item Count Threshold

```reqon
get "/items" {
  paginate: offset(skip, 100),
  until: length(response) < 100  // Less than full page
}
```

## Combining with Other Options

### With Query Parameters

```reqon
get "/users" {
  params: {
    status: "active",
    sort: "created_at"
  },
  paginate: offset(offset, 100),
  until: length(response.users) == 0
}
```

### With Retry

```reqon
get "/users" {
  paginate: cursor(cursor, 100, "nextCursor"),
  until: response.nextCursor == null,
  retry: {
    maxAttempts: 3,
    backoff: exponential
  }
}
```

### With Incremental Sync

```reqon
get "/users" {
  paginate: page(page, 100),
  until: response.hasMore == false,
  since: lastSync
}
```

## Processing Paginated Results

### Accumulative Processing

All pages are accumulated in `response`:

```reqon
action FetchAll {
  get "/items" {
    paginate: offset(offset, 100),
    until: length(response) == 0
  }

  // response now contains ALL items from all pages
  for item in response {
    store item -> items { key: .id }
  }
}
```

### Per-Page Processing

Process each page as it arrives:

```reqon
action ProcessPages {
  get "/items" {
    paginate: offset(offset, 100),
    until: length(response) == 0
  }

  // For each page fetched, items are accumulated
  // After pagination completes, process all
  for item in response {
    // Each item is processed
    store item -> items { key: .id }
  }
}
```

## Common API Patterns

### Standard REST API

```reqon
// API: GET /api/users?limit=100&offset=0
get "/api/users" {
  params: { limit: 100 },
  paginate: offset(offset, 100),
  until: length(response.data) == 0
}
```

### GraphQL-Style Cursor

```reqon
// API uses cursor-based pagination
get "/api/items" {
  paginate: cursor(after, 50, "pageInfo.endCursor"),
  until: response.pageInfo.hasNextPage == false
}
```

### Link Header Pagination

For APIs using Link headers, use cursor pagination:

```reqon
get "/api/items" {
  paginate: cursor(page, 100, "links.next"),
  until: response.links.next == null
}
```

## Best Practices

### Choose the Right Strategy

| API Type | Recommended Strategy |
|----------|---------------------|
| Stable datasets | Offset or Page |
| Real-time data | Cursor |
| Large datasets | Cursor |
| Simple APIs | Page |

### Handle Partial Pages

```reqon
get "/items" {
  paginate: offset(offset, 100),
  until: length(response.items) < 100  // Partial page = last page
}
```

### Set Reasonable Page Sizes

```reqon
// Good: reasonable page size
get "/items" {
  paginate: offset(offset, 100),
  until: length(response) == 0
}

// Avoid: too large (may timeout or exceed limits)
get "/items" {
  paginate: offset(offset, 10000),
  until: length(response) == 0
}

// Avoid: too small (too many requests)
get "/items" {
  paginate: offset(offset, 10),
  until: length(response) == 0
}
```

### Add Safety Limits

```reqon
get "/items" {
  paginate: page(page, 100),
  until: length(response.items) == 0 or page > 100  // Max 100 pages
}
```

### Combine with Rate Limiting

```reqon
source API {
  auth: bearer,
  base: "https://api.example.com",
  rateLimit: {
    requestsPerMinute: 60,
    strategy: "pause"
  }
}

action FetchAll {
  get "/items" {
    paginate: offset(offset, 100),
    until: length(response) == 0
  }
}
```

## Troubleshooting

### Infinite Pagination Loop

If pagination never stops:

```reqon
// Add a safety limit
get "/items" {
  paginate: page(page, 100),
  until: length(response.data) == 0 or page > 50  // Stop after 50 pages
}
```

### Duplicate Items

Some APIs return overlapping results. Use upsert:

```reqon
get "/items" {
  paginate: cursor(cursor, 100, "next"),
  until: response.next == null
}

for item in response {
  store item -> items { key: .id, upsert: true }
}
```

### Missing Items

If items are being missed, check your termination condition:

```reqon
// May miss items if last page has exactly 100 items
until: length(response.items) == 0

// Better: check for less than full page
until: length(response.items) < 100
```
