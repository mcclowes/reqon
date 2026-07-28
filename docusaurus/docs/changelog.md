---
sidebar_position: 99
description: Complete version history and release notes for Reqon.
keywords: [reqon, changelog, releases, version history]
---

# Changelog

All notable changes to Reqon are documented here.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.1.0

_Released 2026-07-27_

A cleanup release. 1.0.0 shipped the bulk fan-out machinery; this one fixes the things a careful read of it turned up, and fills in the handful of built-ins and auth providers the docs had been promising all along.

### Added

- **Built-in functions the docs and examples already assumed existed** - `max`, `min`, `abs`, `concat`, `parseNumber`, `fromUnix`, and `timestamp`. `timestamp()` is the arithmetic-friendly companion to `now()`: epoch milliseconds, so `timestamp() - 86400000` works where `now() - N` threw on an ISO string.
- **`basic` and `api_key` auth providers.** Both were parseable and documented but silently dropped at request time. `api_key` supports a header or a query parameter. An auth type configured without its required credentials now throws rather than sending the request unauthenticated.
- **Per-step pagination caps** - `paginate.maxPages` and `paginate.maxItems`, also configurable on the executor.
- **Webhook payload signature verification** - optional HMAC-SHA256 over the raw body.
- **Member-path subjects in `match` expressions**, so you can match on `.order.status` rather than binding it first.

### Fixed

- **Paginated fetches truncated silently, and the sync checkpoint moved anyway.** When a page or item cap fired, the watermark advanced past records that were never fetched, so the next incremental run skipped them for good. A truncated result now skips the checkpoint flush and emits a `fetch.truncated` event.
- **`redactSecrets` leaked cleartext credentials** into logs and durable trace files. On any repeat visit to a shared or cyclic reference it returned the original unredacted object.
- **A literal `__proto__` key in fetched JSON mangled the merged object** - deep merge hit the prototype setter, dropping the field. It's now written as an own property.
- **The circuit breaker could wedge half-open forever.** An uncounted failure during a probe returned without releasing the single probe slot, blocking recovery. The slot is released on every path, and a lost release self-heals after `probeTimeout`. Per-lane failures also resolve their configured `failureStatusCodes`/`countNetworkErrors` instead of falling back to defaults.
- **Comparison operators couldn't compare dates or strings**, which broke `where .updated_at > lastSync`. Like-typed operands now compare natively: numbers numerically, ISO-8601 strings chronologically, other strings lexicographically. A real type mismatch throws instead of quietly returning false.
- **Webhook server hardening** - constant-time secret comparison, the query-parameter token path removed, an HTTP method allowlist, per-payload HMAC verification, a refusal to start unauthenticated off-loopback, and the socket destroyed after a 413 instead of leaked.
- **Array stores wrote partially on a bad key.** The fallback path validated and wrote one item at a time, so a bad key halfway through left earlier records persisted. Keys are validated up front on both the bulk and fallback paths.
- **Storing a non-record value raises a `RuntimeError`** instead of a generic failure with a bogus source position.
- A falsy request body (`0`, `false`, `""`) was dropped before it reached the wire.
- A dotted placeholder such as `{org.id}` mis-resolved its later segments when the first was absent from the current item.
- `createPause` mutated the caller's `resumeTriggers` array in place.
- `pagesFetched` was always undefined in the `fetch.complete` event, and `isRetryableError` omitted 500 and 504.
- **Every benchmark fixture was written in a dialect the parser has never accepted**, so `npm run bench` failed on every push. All six are rewritten in real Reqon syntax and guarded by a parse test. The store benchmarks no longer run with `dryRun`, which had been skipping the writes they existed to measure.
- **The shipped examples now run.** Several called functions the runtime doesn't implement or did date arithmetic on `now()`.
- **The release workflow rebuilds `better-sqlite3`** after its `--ignore-scripts` install, which is what killed the 1.0.0 tag's publish job. `better-sqlite3` is also approved under `allowScripts` in `package.json`, because npm 12 blocks unapproved install scripts outright where earlier versions only warned.

---

## 1.0.0

_Released 2026-07-26_

The bulk fan-out release. Reqon can now saturate an API it is allowed to saturate: bounded concurrency, egress proxy pools, a rate limiter that paces rather than reacts, and batched store ingest so the store stops being the ceiling. The version number is the other half of the story — the DSL surface and the store/source interfaces are stable enough to promise semver on.

### Added

- **Egress proxy pools on sources** — `proxy: env("PROXY_URL")` for one proxy, or a list for a pool rotated round-robin per request attempt. Rate limit and circuit breaker state are keyed per proxy, so each egress IP gets its own budget and one failing proxy opens only its own circuit. A retry after a 429 leaves from a different IP than the attempt that earned it. Needs the optional peer dependency `undici`.
- **`concurrency N` on `for` loops** — bounded fan-out for bulk fetches, replacing strictly sequential iteration. Defaults to sequential, so existing missions are unchanged. Concurrent iterations get their own step-index namespace, keeping step ids deterministic for durable resume; the debugger forces sequential iteration.
- **Batched store ingest** — `store x: postgrest("t") { batch: 500 }` buffers writes and flushes them as one array POST instead of one request per record, with `{ size, maxDelay, durability }` for finer control. `strict` durability (the default) resolves a write only once its batch has flushed, so a loop iteration isn't done until the record is durable; `relaxed` resolves immediately and flushes in the background. PostgREST gained the `bulkSet`/`bulkUpsert` implementations the store handler was already probing for.
- **Per-item failure tolerance for bulk runs** — a `for` loop continues past a failed item by default, with `onError abort` for strict mode and `onError queue <store>` to capture failures for a later sweep. Fetches can `allow: [404]`, and match arms dispatch on the same number (`404 -> skip`).
- **Rate-limit modelling** — sources pace against a model of the server's limiter instead of only reacting to 429s, including a self-calibrating model for headerless limiters that infers the budget from observed responses. Circuit breaking gains a rate mode (`failureRate`, `minimumRequests`), since an absolute threshold of five failures sits permanently open at thousands of requests a second.
- **Progress-shaped `--verbose`, plus `--log-level` and `--log-format`** — one throttled progress line (processed/total, req/s, p50 latency, retries, failures, ETA) instead of per-item narration. `--verbose` is now `--log-level info`; `--log-level debug` adds the per-item narration back, and `--log-format json` emits newline-delimited JSON.
- **DSL features that the docs advertised but the parser never implemented** — `[Schema]` array match arms, `validate ... or { ... }` fallback blocks, `...spread` in object literals, `??` nullish coalescing, `in` membership over arrays/objects/strings, `[]` subscript indexing (static, dynamic, and negative), and `where` guards with value binding in `match` expressions.
- **`range()` builtin** for generating id sequences without a source fetch.
- **Bulk examples** — `fpl-sharded` (sharded fetch across IPs), `first-500k` and `managers.vague` (fast, resumable, fleet-ready single-file bulk pulls).

### Changed

- **Requires Node 22 or newer.** Node 20 reached end of life in April 2026, and `undici` — the optional peer dependency behind proxy support — needs 22.19 or newer, so proxy pools could never be exercised on 20. CI now covers Node 22 and 24.
- **Loops no longer fail the mission on the first bad item** (validation failures included) unless `onError abort` is set. Tolerated failures are reported as skipped items rather than mission errors.
- **Documentation now describes what the runtime actually does**, rather than the intended design — including which auth schemes are actually wired up, what `sql`/`nosql` stores do without `--dev`, and which pause triggers the shipped runtime dispatches.

### Fixed

- **Pacing never engaged for the workload it exists for.** Rate limit and circuit breaker config was registered under the source name but looked up under the proxy lane key, so any mission with a proxy pool silently ran on defaults. Pacing state was keyed by the interpolated path, so a fan-out over `/entry/{id}/history/` filed every request under its own key. And the throttle measured time since the last request, which cannot pace concurrent callers — it is now reservation-based, so concurrent callers take successive slots. A 429 backs off the whole lane rather than the one URL that tripped it.
- **Proxy pools were separately non-functional** — Node's global fetch rejects a dispatcher built by a different copy of `undici`, so every proxied request died with "fetch failed". Lanes now carry the fetch that owns their dispatcher.
- **File store writes are serialised**, so concurrent writes can no longer drop keys.
- `failureRate` is parsed as a proportion, and the breaker logs the mode in effect.
- A status-only `match` falls through instead of swallowing the result, and `proxy` is genuinely optional.
- Idempotency signature NUL delimiters are written as explicit `\0` escapes.
- Parser and lexer bugs behind several broken examples.

---

## 0.4.0

_Released 2026-06-30_

### Added

- **Append-only execution event log** — the durable foundation for execution state. The executor emits a structured event log, and resuming from it skips already-applied store effects.
- **Durable execution-log backends** — transactional `SqliteExecutionLog` and multi-node `PostgresExecutionLog`, alongside the file store.
- **Pause, incremental sync, and trace as views over the execution log** — unified on the single source of truth, including logged `checkpoint.advanced` and pause lifecycle events.
- **Crash-injection proof suite** with self-healing of a torn execution-log tail, plus `DURABILITY.md` documenting the tested guarantees.
- **Resumable backfill pagination** on the event log.
- **Stable `Idempotency-Key`** for mutating fetches in durable mode.

### Fixed

- **Security hardening** — redact secrets in logs, errors, and durable trace files; lock down token/pause files; confine store paths to the base directory (path traversal); validate and escape PostgREST filters and guard full-table clears; sandbox the MCP server (dryRun default, path confinement, arg validation).
- **Resilience and correctness** — per-request HTTP timeout; gate retries on idempotency; treat 4xx as errors and cap empty/non-JSON responses; single-flight OAuth2 refresh; bound pagination memory and stop dropping/looping pages; require a real key for store dedup with deep-merge; fix `setTimeout` overflow on long timers; POSIX cron OR-fields evaluated in timezone with missed-tick catch-up; resume paused executions exactly once; isolate per-action state in parallel stages; atomic, crash-consistent file and trace writes.

### Changed

- CI drops EOL Node 18; dependabot updates grouped monthly with minor/patch auto-merge.

---

## 0.3.0

_Released 2025-01-08_

### Added

- **Durability features**
  - Checkpoint/resume for fault-tolerant execution - missions can resume after crashes
  - Time-travel debugging with trace snapshots and replay
  - Resource-free pause step with webhook/timeout resume triggers
- **Control server** for pause/resume and live status queries
- **Heartbeat support** for monitoring long-running missions
- **Debug mode** for step-through execution
- **VS Code extension** for Reqon syntax highlighting
- **File store** adapter for persistent JSON storage
- **bulkUpsert** method on store adapters for efficient batch operations
- **Mock server demo** for testing without real APIs

### Changed

- Improved docs site with brand colors, logos, and better readability
- Pre-commit hooks for lint and format
- Better parallel action context isolation

### Fixed

- Mobile hamburger menu visibility
- Various test fixes and CI improvements
- Share link URLs on docs site

---

## 0.2.0

_Released 2024-12-21_

### Added

- Object literal support in expressions
- Guard clauses for conditional execution
- Xero API example enabled

### Changed

- Package renamed from `reqon` to `reqon-dsl`

---

## 0.1.0

_Released 2024-12-01_

Initial release.

### Added

- **DSL syntax** - Mission/action/step structure for declarative pipelines
- **HTTP fetching**
  - GET, POST, PUT, PATCH, DELETE methods
  - Pagination strategies: offset, page number, cursor-based
  - Retry with exponential/linear/constant backoff
  - Incremental sync with `since: lastSync`
- **Store adapters**
  - Memory (testing/temporary)
  - File (JSON persistence)
  - PostgREST/Supabase (SQL)
- **Authentication**
  - OAuth2 with token refresh
  - Bearer token
  - Basic auth
  - API key (header)
- **Resilience**
  - Rate limiting with pause strategy
  - Circuit breaker for cascading failure prevention
- **Scheduling**
  - Cron expressions
  - Fixed intervals (seconds, minutes, hours, days)
  - Daemon mode for continuous execution
- **OpenAPI integration**
  - Load specs from URL or file
  - Type-safe `call` syntax using operationId
  - Response validation against schema
- **Webhook support** with wait step for async callbacks
- **CLI** for running missions from terminal
- **MCP server** for Model Context Protocol integration

---

## Version links

- [GitHub releases](https://github.com/mcclowes/reqon/releases)
- [npm package](https://www.npmjs.com/package/reqon-dsl)
