# Contributing to Reqon

Thank you for your interest in contributing to Reqon! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm
- [Vague](https://github.com/mcclowes/vague) cloned as a sibling directory (required for local development)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/mcclowes/reqon.git
   cd reqon
   ```

2. Clone Vague as a sibling directory:
   ```bash
   cd ..
   git clone https://github.com/mcclowes/vague.git
   cd reqon
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Run tests to verify setup:
   ```bash
   npm run test:run
   ```

## Development Workflow

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch mode compilation |
| `npm run test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage report |

### Project Structure

```
src/
├── ast/           # Extended AST nodes (missions, actions, steps)
├── auth/          # Rate limiting and authentication providers
├── errors/        # Structured error classes
├── execution/     # Execution state management and persistence
├── interpreter/   # Runtime execution (context, evaluator, executor)
├── lexer/         # Reqon keywords (uses Vague's lexer via plugin)
├── oas/           # OpenAPI spec integration
├── parser/        # Parser for mission/action/fetch/store syntax
├── scheduler/     # Cron scheduling for missions
├── stores/        # Store adapters (memory, file, postgrest)
├── sync/          # Incremental sync checkpointing
├── utils/         # Shared utilities
├── index.ts       # Main exports
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
- **Patch** (0.2.0 → 0.2.1): Bug fixes, minor documentation updates
- **Minor** (0.2.0 → 0.3.0): New features, backward-compatible changes
- **Major** (0.2.0 → 1.0.0): Breaking changes

### Release Steps

1. **Update the version:**
   ```bash
   npm run version:patch  # or version:minor, version:major
   ```

2. **Update CHANGELOG.md:**
   - Move items from `[Unreleased]` to a new version section
   - Add the release date
   - Update the comparison links at the bottom

3. **Commit the version bump:**
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: release v0.3.0"
   git push origin main
   ```

4. **Run the release script:**
   ```bash
   npm run release
   ```

   This will:
   - Validate the changelog has the new version entry
   - Run tests and build
   - Create and push the git tag

5. **Monitor the release:**
   - Check [GitHub Actions](https://github.com/mcclowes/reqon/actions) for the release workflow
   - Verify the package appears on [npm](https://www.npmjs.com/package/reqon-dsl)

### Pre-release Versions

For alpha/beta/rc releases:

```bash
# Manually set version
npm version 0.3.0-alpha.1 --no-git-tag-version
# Update CHANGELOG.md
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
git tag -d v0.3.0
# Delete remote tag (if pushed by mistake)
git push origin :refs/tags/v0.3.0
```

**Release workflow failed:**
- Check the [Actions tab](https://github.com/mcclowes/reqon/actions) for error details
- Common issues: missing `NPM_TOKEN`, test failures, version mismatch

## Questions?

Open an issue for questions about contributing or the codebase architecture.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
