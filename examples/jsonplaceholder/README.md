# JSONPlaceholder Example

Demonstrates basic Reqon usage with a public API (no authentication).

## What it does

1. Fetches 100 posts from JSONPlaceholder API
2. Maps each post to a normalized `StandardPost` schema
3. Stores results in memory

## Run

```bash
node dist/cli.js examples/jsonplaceholder/posts.reqon --verbose
```

Export to JSON:
```bash
node dist/cli.js examples/jsonplaceholder/posts.reqon --output output.json
```

## Features demonstrated

- `auth: none` for public APIs
- `get` for simple requests
- `map` for schema transformation
- `for...in` iteration over stored items
- `run...then` for action sequencing
