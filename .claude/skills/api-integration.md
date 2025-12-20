# API Integration Patterns Skill

Use this skill when implementing API client functionality, authentication flows, rate limiting, or pagination in Reqon.

## Capabilities

### OAuth2 Token Refresh Flows
- Implement automatic token refresh on 401 responses
- Handle refresh token rotation
- Store and retrieve tokens securely
- Support authorization_code, client_credentials, and refresh_token grants

### Rate Limiting with Exponential Backoff
- Parse rate limit headers (X-RateLimit-*, Retry-After)
- Implement exponential backoff with jitter
- Queue requests when rate limited
- Respect per-endpoint rate limits

### Pagination Pattern Implementations
- **Cursor-based**: Use `next_cursor` or `after` parameters
- **Offset-based**: Use `offset` and `limit` parameters
- **Page-based**: Use `page` and `per_page` parameters
- **Link header**: Parse RFC 5988 Link headers

## Context Files
When using this skill, read:
- `src/interpreter/http.ts` - HTTP client implementation
- `src/interpreter/executor.ts` - Fetch execution logic
- `src/ast/nodes.ts` - FetchNode, PaginationConfig types

## Implementation Patterns

### OAuth2 Token Refresh
```typescript
async function fetchWithAuth(url: string, auth: OAuth2Auth): Promise<Response> {
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });

  if (response.status === 401 && auth.refreshToken) {
    const newTokens = await refreshAccessToken(auth);
    auth.accessToken = newTokens.access_token;
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }

  return response;
}
```

### Exponential Backoff
```typescript
async function fetchWithBackoff(
  url: string,
  maxRetries = 5,
  baseDelay = 1000
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await sleep(delay);
      continue;
    }

    return response;
  }
  throw new Error('Max retries exceeded');
}
```

### Pagination Patterns

#### Cursor-based
```typescript
async function* paginateCursor(baseUrl: string) {
  let cursor: string | undefined;
  do {
    const url = cursor ? `${baseUrl}?cursor=${cursor}` : baseUrl;
    const response = await fetch(url);
    const data = await response.json();
    yield data.items;
    cursor = data.next_cursor;
  } while (cursor);
}
```

#### Offset-based
```typescript
async function* paginateOffset(baseUrl: string, limit = 100) {
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const response = await fetch(`${baseUrl}?offset=${offset}&limit=${limit}`);
    const data = await response.json();
    yield data.items;
    offset += limit;
    hasMore = data.items.length === limit;
  }
}
```

#### Link Header
```typescript
function parseLinks(header: string): Record<string, string> {
  const links: Record<string, string> = {};
  header.split(',').forEach(part => {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  });
  return links;
}
```

## Rate Limit Headers
Common headers to parse:
- `X-RateLimit-Limit` - Request limit per window
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Unix timestamp when limit resets
- `Retry-After` - Seconds to wait (on 429/503)
