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
