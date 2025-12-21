# JSONPlaceholder Example

Demonstrates basic Reqon usage with a public API (no authentication).

## What it does

1. Fetches 100 posts from JSONPlaceholder API
2. Maps each post to a normalized `StandardPost` schema
3. Stores results in memory

## Run

```bash
node dist/cli.js examples/jsonplaceholder/posts.vague --verbose
```

Export to JSON:
```bash
node dist/cli.js examples/jsonplaceholder/posts.vague --output output.json
```

## Features demonstrated

- `auth: none` for public APIs
- `get` for simple requests
- `memory()` store for quick prototyping (no setup required)
- `map` for schema transformation
- `for...in` iteration over stored items
- `run...then` for action sequencing
