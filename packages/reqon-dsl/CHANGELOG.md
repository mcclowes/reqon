# Changelog

## 1.3.0

### Minor Changes

- a0a46a7: Make Reqon embeddable in apps and serverless functions:

  - `since: lastSync { token: "nextSyncToken" }` stores an opaque sync token from the last page and sends it back verbatim next run (Google People, Graph delta). With no token yet the fetch is a full sync. A response without a token leaves the checkpoint alone.
  - `ExecutorConfig.inputs` plus `input("name")` pass per-run values into a mission.
  - `ExecutorConfig.signal` cancels a run: in-flight requests abort, nothing retries, and the run fails with `ExecutionAbortedError`.
  - `FetchError.body` carries the parsed JSON error body (credential keys redacted). `FetchError` and `ExecutionAbortedError` are now exported.
  - `ExecutionResult.truncated` lists paginated fetches that stopped at a safety cap, so a host can tell a partial result from a complete one.

### Patch Changes

- b6becb2: Append pagination, `since` and auth query parameters with `&` when the fetch path already has a query string. They were joined with a second `?`, so a path like `"/items?fields=a"` sent a broken URL as soon as it paginated.

## 1.2.0

### Minor Changes

- 502f748: Add `blockPrivateNetworks` to `ExecutorConfig`. When on, every request and redirect hop must resolve to a public address; loopback, private, link-local, metadata and reserved ranges throw `EgressBlockedError` without retrying. Off by default.

### Patch Changes

- cc8702c: Send a source's `headers` block on every request. The block parsed but never reached the HTTP client, so declared headers were silently dropped. Values are evaluated once at source init, so `env()` works, and auth provider headers still win on collision.

The changelog has moved to the documentation site:

**[https://reqon.mcclowes.com/changelog](https://reqon.mcclowes.com/changelog)**

This keeps the changelog alongside the rest of the documentation and ensures it stays up to date.
