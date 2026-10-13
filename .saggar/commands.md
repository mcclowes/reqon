# Commands

- dev: `npm run dev` - Watch the runtime and update compiled output. #monitor #safe #long-running
- docs: `npm --prefix docusaurus run start` - Serve the docs locally and update its build cache. #monitor #safe #long-running

## Local checks

- build: `npm run build` - Compile the runtime into its dist directory. #safe #ci
- typecheck: `npm run typecheck` - Check runtime and test types without emitting files. #safe #ci
- lint: `npm run lint` - Check runtime source with ESLint. #safe #ci
- format:check: `npm run format:check` - Check runtime source formatting. #safe #ci
- check:docs: `npm run check:docs` - Validate documentation snippets against the existing build; run build first. #safe #ci
- check:examples: `npm run check:examples` - Parse shipped examples against the existing build; run build first. #safe #ci
- check:snippets: `npm run check:snippets` - Build, then validate docs and examples. #safe
- test:local: `env -u RUN_NETWORK_TESTS -u DATABASE_URL npm run test:run` - Run the full local suite with live API and Postgres opt-ins unset; tests write fixture state and bind temporary local ports. #safe #ci #slow
- test:crash: `npm run test:crash` - Exercise crash boundaries and write isolated durability fixtures. #safe #ci #slow

## Tests with environment-dependent effects

The full suite enables live API tests for any nonempty `RUN_NETWORK_TESTS`, including `0`, and Postgres tests when `DATABASE_URL` is set. Use disposable services when enabling them; use `test:local` for local validation.

- test: `npm run test` - Watch tests; inherited environment can enable live API requests and database writes. #destructive #long-running
- test:run: `npm run test:run` - Run all tests once; inherited environment can enable live API requests and database writes. #destructive #slow
- test:coverage: `npm run test:coverage` - Run the suite and write coverage reports; inherited environment can enable external effects. #destructive #slow
- test:integration: `npm run test:integration` - Enable live third-party API tests, including POST, PATCH, and DELETE requests. #destructive #slow
- test:pg: `npm run test:pg` - Run the execution-log contract against DATABASE_URL; requires a disposable Postgres database. #destructive #slow

## Local maintenance

- lint:fix: `npm run lint:fix` - Apply ESLint fixes to runtime source. #writes
- format: `npm run format` - Format runtime source with Prettier. #writes
- bench: `npm run bench` - Run benchmarks and print their results; npx may fetch tsx into its cache if it is unavailable locally. #safe #slow
- prepare: `npm run prepare` - Configure Husky Git hooks for this checkout. #writes
- changeset: `npm run changeset` - Interactively write a release changeset. #writes #interactive
- version: `npm run version` - Apply pending Changesets to local package versions and changelogs. #writes

## Publication

- release: `npm run release` - Publish workspace packages and create release tags through Changesets. #destructive #slow
