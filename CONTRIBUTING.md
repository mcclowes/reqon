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
├── lexer/         # Extended lexer with Reqon keywords
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
- Minimal reproduction case (ideally a `.reqon` snippet)
- Expected vs actual behavior
- Error messages and stack traces

## Questions?

Open an issue for questions about contributing or the codebase architecture.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
