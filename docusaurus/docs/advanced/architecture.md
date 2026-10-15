---
sidebar_position: 0
---

# How Reqon extends Vague

Reqon uses Vague's language infrastructure and schema types to describe API
pipelines. Reqon owns mission execution: it decides when to fetch, transform,
validate, and store data. This boundary lets the two packages share a language
without making Vague responsible for Reqon's network and persistence behavior.

The public `parse()` and `execute()` functions follow this path:

```text
source → ReqonLexer → ReqonParser → ReqonProgram
                                      ↓
                               MissionExecutor
                                      ↓
                         step handlers and adapters
```

`parse()` stops at the AST. `execute()` parses the source and passes that AST to
`MissionExecutor`. Parsing a mission does not send its HTTP requests or write
its stores.

## Keywords and operators

Importing Reqon registers `reqonPlugin` with Vague. Its keyword map teaches
Vague's lexer to recognize words such as `mission`, `source`, and `get` as
Reqon tokens. Registration is idempotent through `registerReqonPlugin()`.

Reqon's own lexer subclasses Vague's lexer and adds operator scanning for `!=`,
`!`, `??`, and `...`. It delegates other scanning to Vague and leaves Vague's
shared lexer prototype unchanged. Keyword registration and operator scanning are
separate mechanisms; the keyword plugin alone does not add those operators to
Vague's lexer.

## Two parser entry points

The package's `parse()` function uses `ReqonParser`, which builds a
`ReqonProgram` containing mission, source, store, action, and related nodes.
Mission parsing collects its definitions and requires a `run` pipeline.

The Vague plugin also registers a statement parser for `mission`. When Vague's
parser encounters that statement, the plugin collects its balanced brace-delimited
tokens and delegates them to `ReqonParser`, returning the resulting mission node
to Vague's outer program. This is syntax integration; it does not install a
mission executor in Vague. Use Reqon's `parse()` entry point for Reqon's complete
lexer and parser behavior.

Reqon maintains its own expression parser using Vague's expression AST types.
Compatibility tests compare shared expressions with Vague's parser, including
precedence, calls, arrays, ranges, and matches. Reqon adds expressions such as
nullish coalescing, type checks, object spread, and computed indexing.

Schema parsing first normalizes schema tokens and delegates to Vague's
`StatementParser`. This preserves Vague's richer schema forms. A fallback parser
retains Reqon's older JSON-shaped array and inline-object field syntax.

## Runtime ownership

`MissionExecutor` creates the execution context and coordinates sources, stores,
pipeline stages, and step handlers. Reqon's evaluator resolves expressions
against that context, including variables, the current response, and the current
record. Shared AST types do not mean that Vague's evaluator runs Reqon steps.

Individual handlers perform the work. Fetching uses Reqon's HTTP and source
infrastructure; validation uses its schema matcher and expression evaluator;
store operations go through store adapters. The `generate` handler calls Vague's
`Generator` with the mission's schemas and an optional seed, then places the
result in Reqon's variables and response.

Runtime integrations such as custom stores are passed through `ExecutorConfig`.
They are separate from the Vague language plugin. See
[Extending Reqon](./extending-reqon) for those interfaces and
[durability](../durability/overview) for execution-log and resume behavior.

## Source map

All paths below are relative to
[`packages/reqon-dsl/src`](https://github.com/mcclowes/reqon/tree/main/packages/reqon-dsl/src):

| Responsibility | Source |
| --- | --- |
| Public parse/execute entry points | [`index.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/index.ts) |
| Vague keyword and mission registration | [`plugin.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/plugin.ts) |
| Reqon operator scanning | [`lexer/lexer.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/lexer/lexer.ts) |
| Mission and expression parsing | [`parser/parser.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/parser/parser.ts), [`parser/expressions.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/parser/expressions.ts) |
| Schema delegation and fallback | [`parser/action-parser.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/parser/action-parser.ts) |
| Mission execution and evaluation | [`interpreter/executor.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/interpreter/executor.ts), [`interpreter/evaluator.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/interpreter/evaluator.ts) |
| Vague-backed fixture generation | [`interpreter/step-handlers/generate-handler.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/interpreter/step-handlers/generate-handler.ts) |

[`plugin.test.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/plugin.test.ts)
checks Vague's mission delegation.
[`parser/vague-compatibility.test.ts`](https://github.com/mcclowes/reqon/blob/main/packages/reqon-dsl/src/parser/vague-compatibility.test.ts)
checks the shared expression AST contract.
