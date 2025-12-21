# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

## [0.2.0] - 2024-12-21

### Added
- Object literal support in expressions
- Guard clauses for conditional execution
- Xero API example enabled

### Changed
- Package renamed from `reqon` to `reqon-dsl`

## [0.1.0] - 2024-12-01

### Added
- Initial release
- Mission/action/step DSL syntax
- HTTP fetch with pagination (offset, page, cursor)
- Store adapters (memory, file, postgrest)
- OAuth2, Bearer, Basic, and API key authentication
- Rate limiting and circuit breaker
- Incremental sync with checkpointing
- Webhook support with wait step
- Cron and interval scheduling
- OpenAPI spec integration
- CLI and MCP server

[Unreleased]: https://github.com/mcclowes/reqon/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mcclowes/reqon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mcclowes/reqon/releases/tag/v0.1.0
