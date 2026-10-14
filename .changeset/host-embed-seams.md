---
'reqon-dsl': minor
---

Make Reqon embeddable in apps and serverless functions:

- `since: lastSync { token: "nextSyncToken" }` stores an opaque sync token from the last page and sends it back verbatim next run (Google People, Graph delta). With no token yet the fetch is a full sync. A response without a token leaves the checkpoint alone.
- `ExecutorConfig.inputs` plus `input("name")` pass per-run values into a mission.
- `ExecutorConfig.signal` cancels a run: in-flight requests abort, nothing retries, and the run fails with `ExecutionAbortedError`.
- `FetchError.body` carries the parsed JSON error body (credential keys redacted). `FetchError` and `ExecutionAbortedError` are now exported.
- `ExecutionResult.truncated` lists paginated fetches that stopped at a safety cap, so a host can tell a partial result from a complete one.
