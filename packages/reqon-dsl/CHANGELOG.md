# Changelog

## 1.2.0

### Minor Changes

- 502f748: Add `blockPrivateNetworks` to `ExecutorConfig`. When on, every request and redirect hop must resolve to a public address; loopback, private, link-local, metadata and reserved ranges throw `EgressBlockedError` without retrying. Off by default.

### Patch Changes

- cc8702c: Send a source's `headers` block on every request. The block parsed but never reached the HTTP client, so declared headers were silently dropped. Values are evaluated once at source init, so `env()` works, and auth provider headers still win on collision.

The changelog has moved to the documentation site:

**[https://reqon.mcclowes.com/changelog](https://reqon.mcclowes.com/changelog)**

This keeps the changelog alongside the rest of the documentation and ensures it stays up to date.
