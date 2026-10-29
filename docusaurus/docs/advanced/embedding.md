---
sidebar_position: 6
description: Run Reqon missions inside a web app or serverless function, per user, with inputs, deadlines, host-owned sync state and typed errors.
keywords: [reqon, embedding, serverless, vercel, next.js, multi-tenant, inputs, abort]
---

# Embedding Reqon

The CLI runs one mission against one set of credentials. An app usually wants something else: run a mission for the user making a request, finish before the request's deadline, keep sync state in the app's own database, and turn API failures into its own error states. `ExecutorConfig` covers each of these.

```typescript
import { execute, FetchError, ExecutionAbortedError, MemorySyncStore } from 'reqon-dsl';

const syncStore = new MemorySyncStore();
if (saved.syncToken) {
  await syncStore.recordSync({ key: 'people', syncedAt: saved.syncedAt, cursor: saved.syncToken });
}

const result = await execute(mission, {
  auth: { People: { type: 'bearer', token: user.accessToken } },
  inputs: { userId: user.id },
  syncStore,
  signal: AbortSignal.timeout(45_000),
});

const checkpoint = await syncStore.getCheckpoint('people');
const people = await result.stores.get('people')!.list();
```

## Per-run credentials and inputs

Pass credentials per run through `auth`, keyed by source name, rather than through `env()`. A source declared `auth: bearer` takes `{ type: 'bearer', token }`.

Pass anything else the mission needs through `inputs` and read it with `input("name")`. Like `env`, the name must be a string literal, so fetched data can't choose which value is read. Don't build mission source by interpolating user values into it. Anything a user can influence could change the mission itself.

## Deadlines

`signal` takes any `AbortSignal`. When it fires, in-flight requests are aborted, nothing is retried, no further steps start, and the run fails with an `ExecutionAbortedError` in `result.errors[0].details`. `AbortSignal.timeout(ms)` bounds the whole run, unlike a source's per-attempt `timeout`.

## Host-owned sync state

The default sync store writes files under `.reqon-data`, which a serverless function doesn't keep between invocations. Pass a `syncStore` instead:

- Seed a `MemorySyncStore` from your database before the run, and read the checkpoint back after it, as above.
- Or implement `SyncStore` over your database directly (see [Extending Reqon](./extending-reqon.md)).

A checkpoint's `cursor` holds the opaque token for `since: lastSync { token: "..." }` (see [incremental sync](../http/incremental-sync.md)). The checkpoint is recorded only after the run's data is stored, and it isn't advanced by a truncated or token-less fetch.

Stores work the same way. `memory` stores come back on `result.stores`, or you can pass your own `StoreAdapter`s under `stores`.

## Errors

A failed request surfaces as a `FetchError` in `result.errors[n].details`, with:

- `statusCode`: the HTTP status
- `body`: the parsed JSON error body, with credential-looking keys redacted. It's `undefined` when the body wasn't JSON

That's enough to map provider errors to your own states:

```typescript
const error = result.errors[0]?.details;
if (error instanceof FetchError && error.statusCode === 410) {
  await syncStore.clear('people');
  // run again for a full sync
}
```

## Partial results

A paginated fetch that hits a page or item cap stops early, and the run still succeeds. `result.truncated` lists each one, with its `path`, `reason` (`page-cap` or `item-cap`) and how far it got. Its sync checkpoint isn't advanced. If you need every record, treat a truncated result as a failure. Raise the caps with `maxPaginationPages` and `maxPaginationItems`.

## Untrusted URLs

When a mission's URLs come from users, set `blockPrivateNetworks: true` so requests and redirects can't reach loopback, private or cloud metadata addresses. See [ExecutorConfig](../api-reference.md#executorconfig).
