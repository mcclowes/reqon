---
sidebar_position: 99
description: Complete version history and release notes for Reqon.
keywords: [reqon, changelog, releases, version history]
---

# Changelog

All notable changes to Reqon are documented here.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **Egress proxy pools on sources** — `proxy: env("PROXY_URL")` for one proxy, or a list for a pool rotated round-robin per request attempt. Rate limit and circuit breaker state are keyed per proxy, so each egress IP gets its own budget and one failing proxy opens only its own circuit. A retry after a 429 leaves from a different IP than the attempt that earned it. Needs the optional peer dependency `undici`.
- **`concurrency N` on `for` loops** — bounded fan-out for bulk fetches, replacing strictly sequential iteration. Defaults to sequential, so existing missions are unchanged. Concurrent iterations get their own step-index namespace, keeping step ids deterministic for durable resume; the debugger forces sequential iteration.
- **`fpl-sharded` example** — sharded bulk fetch across IPs, and a note on when the one-request version is all you need.

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
  - API key (header or query)
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
