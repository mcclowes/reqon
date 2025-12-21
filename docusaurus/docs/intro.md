---
sidebar_position: 1
slug: /
---

# Introduction to Reqon

Reqon is a **declarative DSL framework for building fetch, map, validate pipelines**. It's designed to make API data synchronization simple, reliable, and maintainable.

## What is Reqon?

Reqon allows you to define data pipelines using a clean, readable syntax. Instead of writing imperative code to fetch data, transform it, validate it, and store it, you declare *what* you want to happen, and Reqon handles *how* it happens.

```reqon
mission SyncCustomers {
  source API { auth: bearer, base: "https://api.example.com" }
  store customers: file("customers")

  action FetchCustomers {
    get "/customers" { paginate: offset(page, 100) }
    for customer in response.data {
      map customer -> Customer {
        id: .id,
        name: .name,
        email: .email
      }
      store customer -> customers { key: .id }
    }
  }

  run FetchCustomers
}
```

## Why Reqon?

### Declarative by Design

Traditional data pipelines require writing boilerplate code for HTTP requests, pagination, retries, error handling, and more. Reqon abstracts these concerns into a clean DSL, letting you focus on your business logic.

### Built-in Best Practices

- **Automatic pagination** - Handle offset, page number, or cursor-based pagination
- **Retry with backoff** - Exponential, linear, or constant backoff strategies
- **Rate limiting** - Respects API rate limits automatically
- **Circuit breaker** - Prevents cascading failures
- **Incremental sync** - Only fetch changes since last run

### Extensible Architecture

Reqon is built on [Vague](https://github.com/mcclowes/vague), a general-purpose expression DSL. This means you get powerful expression syntax for transformations and validations, while Reqon adds the execution semantics for data pipelines.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Reqon                      │
│  ┌─────────────────────────────────────┐    │
│  │  Missions, Actions, Pipelines       │    │
│  │  HTTP, Stores, Scheduling           │    │
│  └─────────────────────────────────────┘    │
│                    │                        │
│  ┌─────────────────▼─────────────────┐      │
│  │              Vague                 │     │
│  │  Lexer, Parser, Expressions        │     │
│  │  Match, Schema, Types              │     │
│  └───────────────────────────────────┘      │
└─────────────────────────────────────────────┘
```

- **Vague** provides the DSL layer (lexer, parser, expression syntax)
- **Reqon** provides the runtime/framework with execution semantics

For expression syntax, pattern matching, and schema definitions, refer to the [Vague documentation](https://github.com/mcclowes/vague).

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Mission** | A complete data pipeline with sources, stores, and actions |
| **Source** | An API endpoint with authentication configuration |
| **Store** | A storage backend (memory, file, SQL, NoSQL) |
| **Action** | A sequence of steps that process data |
| **Step** | A single operation (fetch, map, validate, store, etc.) |

## Next Steps

- [Getting Started](./getting-started) - Install Reqon and run your first mission
- [Core Concepts](./category/core-concepts) - Learn about missions, actions, and more
- [Examples](./examples) - See real-world examples
