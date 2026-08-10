# Contributing to Reqon

Thank you for your interest in contributing to Reqon! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 22 or higher (CI runs 22 and 24)
- npm

[Vague](https://github.com/mcclowes/vague) is a published npm dependency
(`vague-lang`); you no longer need it checked out as a sibling directory.

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/mcclowes/reqon.git
   cd reqon
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Run tests to verify setup:
   ```bash
   npm run test:run
   ```

Some suites need optional peer dependencies, all of which are installed as dev
dependencies: `better-sqlite3` (SQLite execution log), `pg` (Postgres execution
log — `npm run test:pg` also needs a running Postgres), and `undici` (egress
proxy pools).

## Development Workflow

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch mode compilation |
| `npm run typecheck` | Type-check without emitting |
| `npm run test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:crash` | Crash-injection durability suite |
| `npm run test:pg` | Postgres execution-log tests (needs a Postgres) |
| `npm run check:docs` | Every reqon/vague block in the docs lexes; complete ones parse |
| `npm run check:examples` | Every mission under `examples/` parses |
| `npm run check:snippets` | `build` + `check:docs` + `check:examples` |
| `npm run lint` | ESLint over `src/` |
| `npm run format` | Prettier write over `src/` |
| `npm run bench` | Performance benchmarks |

The two snippet checkers import from `dist/`, so build first when running them on
their own. `npm run check:snippets` does that for you.

CI gates on `typecheck`, `lint`, `format:check`, `test:run`, `build`,
`check:docs`, `check:examples`, `test:crash`, `test:pg`, and `npm audit`
(critical severity, production dependencies only). The pre-commit hook runs
lint-staged (eslint + prettier) and the full test suite, but not `typecheck` -
vitest compiles with esbuild, which strips types without checking them. Run
`npm run typecheck` yourself before pushing.

If you change a documented DSL snippet, run `npm run check:snippets` before
pushing. It's what stops the docs drifting into syntax the parser never accepted.

### Project Structure

```
src/
├── ast/           # Extended AST nodes (missions, actions, steps)
├── auth/          # Rate limiting, circuit breaker, credentials, auth providers
├── benchmark/     # Performance benchmarks
├── config/        # Runtime configuration and constants
├── control/       # Control server for pause/resume and status queries
├── debug/         # CLI debugger and debug controller
├── durability/    # Crash-injection tests for durable execution
├── errors/        # Structured error classes
├── execution/     # Execution state management and persistence
├── execution-log/ # Append-only event log (file/sqlite/postgres stores)
├── interpreter/   # Runtime execution (context, evaluator, executor, step handlers)
├── lexer/         # Reqon keywords (uses Vague's lexer via plugin)
├── loader/        # Mission loader (single file or folder of action files)
├── mcp/           # Model Context Protocol server
├── oas/           # OpenAPI spec integration
├── observability/ # Structured events, logging, OpenTelemetry
├── parser/        # Parser for mission/action/fetch/store syntax
├── pause/         # Resource-free long pauses
├── scheduler/     # Cron/interval scheduling for missions
├── stores/        # Store adapters (memory, file, postgrest) + batching wrapper
├── sync/          # Incremental sync checkpointing
├── trace/         # Time-travel debugging
├── utils/         # Shared utilities
├── webhook/       # Webhook server for async callbacks
├── index.ts       # Main exports
├── plugin.ts      # Vague plugin integration
└── cli.ts         # CLI entry point
```

## Code Conventions

### TypeScript

- Strict mode is enabled
- Use explicit types for function parameters and return values
- Prefer `interface` over `type` for object shapes

### Testing

- Tests use [Vitest](https://vitest.dev/)
- Test files are co-located with implementation: `feature.ts` → `feature.test.ts`
- Write tests for new functionality
- Ensure existing tests pass before submitting

Example test structure:
```typescript
import { describe, it, expect } from 'vitest';

describe('FeatureName', () => {
  it('should do something specific', () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected);
  });
});
```

### Architecture

Reqon extends [Vague](https://github.com/mcclowes/vague), which provides the core DSL layer (lexer, parser, expression syntax). Reqon adds:

- Mission/action/step AST nodes
- HTTP fetch with pagination and retry
- Store adapters for persistence
- Execution context and runtime

When adding features:
- Extend Vague's lexer/parser if adding new expression syntax
- Add new step types in `src/ast/` and handle them in `src/interpreter/executor.ts`
- New store backends implement the `StoreAdapter` interface in `src/stores/`

## Submitting Changes

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure tests pass: `npm run test:run`
5. Ensure the build succeeds: `npm run build`
6. Submit a pull request

### Commit Messages

Write clear, concise commit messages that describe what changed and why:

```
Add cursor-based pagination support

- Implement cursor pagination strategy in pagination.ts
- Add cursor option to fetch step parser
- Add tests for cursor pagination
```

### Code Review

All submissions require review. We aim to provide feedback within a few days.

## Reporting Issues

When reporting bugs, please include:

- Reqon version
- Node.js version
- Minimal reproduction case (ideally a `.vague` snippet)
- Expected vs actual behavior
- Error messages and stack traces

## Release Process (Maintainers)

This section documents how to release a new version of Reqon.

### Prerequisites

- Push access to the repository
- `NPM_TOKEN` configured in GitHub Secrets (for automated publishing)

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):
- **Patch** (1.1.0 → 1.1.1): Bug fixes, minor documentation updates
- **Minor** (1.1.0 → 1.2.0): New features, backward-compatible changes
- **Major** (1.1.0 → 2.0.0): Breaking changes

### Release Steps

1. **Update the version:**
   ```bash
   npm run version:patch  # or version:minor, version:major
   ```

2. **Update the changelog** at `docusaurus/docs/changelog.md` (the root
   `CHANGELOG.md` is just a pointer to the docs site). The release script
   validates the format, so it needs both:
   - a `## <version>` heading matching `package.json` exactly
   - a `_Released YYYY-MM-DD_` line under it

3. **Commit the version bump:**
   ```bash
   git add package.json docusaurus/docs/changelog.md
   git commit -m "chore: release v1.2.0"
   git push origin main
   ```

4. **Run the release script:**
   ```bash
   npm run release
   ```

   This will:
   - Check the working tree is clean (it exits if not) and warn if you aren't on `main`
   - Validate the changelog has the new version entry and a release date
   - Check the tag doesn't already exist
   - Run tests and build
   - Create and push the git tag

5. **Monitor the release:**
   - Check [GitHub Actions](https://github.com/mcclowes/reqon/actions) for the release workflow
   - Verify the package appears on [npm](https://www.npmjs.com/package/reqon-dsl)

### Pre-release Versions

For alpha/beta/rc releases:

```bash
# Manually set version
npm version 1.2.0-alpha.1 --no-git-tag-version
# Update docusaurus/docs/changelog.md
# Commit and run release
npm run release
```

Pre-releases are published with the `next` npm tag:
```bash
npm install reqon-dsl@next
```

### Dry Run

To preview a release without making changes:
```bash
npm run release -- --dry-run
npm run release:dry-run  # Preview npm publish
```

### Troubleshooting

**Tag already exists:**
```bash
# Delete local tag
git tag -d v1.2.0
# Delete remote tag (if pushed by mistake)
git push origin :refs/tags/v1.2.0
```

**Release workflow failed:**
- Check the [Actions tab](https://github.com/mcclowes/reqon/actions) for error details
- Common issues: missing `NPM_TOKEN`, test failures, version mismatch

## Questions?

Open an issue for questions about contributing or the codebase architecture.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
