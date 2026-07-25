---
sidebar_position: 2
description: Install Reqon and run your first data pipeline in minutes. Learn the basic mission structure with step-by-step examples.
keywords: [reqon, installation, getting started, tutorial, first mission]
---

# Getting started

This guide helps you install Reqon and run your first data pipeline.

## Prerequisites

- Node.js 20 or later
- npm or yarn

## Installation

Reqon is published as `reqon-dsl`. Installing it adds the `reqon` CLI binary.

```bash
npm install reqon-dsl
```

Or if you prefer yarn:

```bash
yarn add reqon-dsl
```

## Your first mission

Create a file called `hello.vague`:

```vague
mission HelloWorld {
  source JSONPlaceholder {
    auth: none,
    base: "https://jsonplaceholder.typicode.com"
  }

  store posts: memory("posts")

  action FetchPosts {
    get "/posts"

    for post in response {
      map post -> Post {
        id: .id,
        title: .title,
        body: .body,
        userId: .userId
      }
      store post -> posts { key: .id }
    }
  }

  run FetchPosts
}
```

## Running your mission

### Using the CLI

```bash
npx reqon hello.vague
```

With verbose output:

```bash
npx reqon hello.vague --verbose
```

### Using the API

```typescript
import { execute } from 'reqon-dsl';

const result = await execute(`
  mission HelloWorld {
    source JSONPlaceholder { auth: none, base: "https://jsonplaceholder.typicode.com" }
    store posts: memory("posts")

    action FetchPosts {
      get "/posts"
      store response -> posts { key: .id }
    }

    run FetchPosts
  }
`);

const posts = await result.stores.get('posts')?.list();
console.log(`Fetched ${posts?.length ?? 0} posts`);
```

## Understanding the output

When you run a mission, Reqon provides detailed execution information:

```
[Reqon] Starting mission: HelloWorld
[Reqon] Running action: FetchPosts
[Reqon] GET https://jsonplaceholder.typicode.com/posts
[Reqon] Stored 100 items to posts
[Reqon] Mission completed in 234ms
```

## Mission structure

Every Reqon mission follows this structure:

```vague
mission MissionName {
  // 1. Define data sources (APIs)
  source SourceName { auth: bearer, base: "https://api.example.com" }

  // 2. Define storage targets (memory, file, postgrest, sql, nosql)
  store storeName: memory("name")

  // 3. Define schemas (optional, for validation)
  schema SchemaName { field: string }

  // 4. Define actions (processing steps)
  action ActionName {
    // Steps: fetch, map, validate, store, for, match
    get "/data"
  }

  // 5. Define the pipeline
  run ActionName then AnotherAction
}
```

## Adding transformations

Use `map` to transform data:

```vague
action TransformPosts {
  get "/posts"

  for post in response {
    map post -> BlogPost {
      id: .id,
      title: .title,
      excerpt: substring(.body, 0, 100),
      author: concat("User ", .userId)
    }
    store post -> posts { key: .id }
  }
}
```

## Adding validation

Use `validate` to check constraints:

```vague
action ValidatedFetch {
  get "/posts"

  for post in response {
    validate post {
      assume .id > 0,
      assume length(.title) > 0,
      assume .userId is number
    }
    store post -> posts { key: .id }
  }
}
```

## Handling pagination

Most APIs require pagination. Reqon makes this easy:

```vague
action FetchAllPosts {
  get "/posts" {
    paginate: offset(offset, 20),
    until: length(response) == 0
  }

  store response -> posts { key: .id }
}
```

## Error handling

Use `match` to branch on the response's schema. Match arms are keyed by schema name (or `_` for the fallback), so declare a schema for the shape you want to catch:

```vague
schema ApiError { error: string }

action RobustFetch {
  get "/posts"

  match response {
    ApiError -> abort "API returned an error",
    _ -> store response -> posts { key: .id }
  }
}
```

## Next steps

Now that you've run your first mission, explore these topics:

- [Core Concepts](./category/core-concepts) - Understand missions, actions, sources, and stores
- [DSL Syntax](./category/dsl-syntax) - Learn the complete Reqon syntax
- [Authentication](./category/authentication) - Connect to authenticated APIs
- [Examples](./examples) - See more complex examples

## Common issues

:::tip
Use `--dry-run` to validate your mission syntax without making actual API calls.
:::

### "Source not found" error

Make sure you've defined the source before using it in an action:

```vague
mission Example {
  source API { auth: none, base: "https://api.example.com" }  // Define first

  action FetchData {
    get "/data"  // Uses the default source
  }

  run FetchData
}
```

### "Store not found" error

Ensure stores are defined at the mission level:

```vague
mission Example {
  store myData: memory("data")  // Define at mission level

  action SaveData {
    get "/data"
    store response -> myData { key: .id }  // Use in actions
  }

  run SaveData
}
```

### Network errors

Add retry configuration for unreliable networks:

```vague
get "/data" {
  retry: {
    maxAttempts: 3,
    backoff: exponential,
    initialDelay: 1000
  }
}
```

:::info
For production use, always configure retry and rate limiting to handle transient failures gracefully.
:::
