# Reqon code review

_A holistic review of the Reqon DSL runtime (v0.3.0, 45k LOC, 122 source files). Reviewed by a skeptical onboarding engineer. Findings are backed by file:line references; the most consequential ones were reproduced or confirmed at the source._

> **Update — fixes applied.** Most of the critical and high findings below have since been fixed on `fix/code-review-findings`, each with a regression test. See [the disposition table](#fixes-applied) at the end for what landed and what was deliberately deferred. The suite went from 1,155 to 1,226 passing tests, and `npm run typecheck` is green again.

---

## Verdict up front

Reqon is ambitious and, in places, genuinely careful. The atomic file-write helper, the path-traversal guards, the torn-log healing, and the PostgREST query escaping are all the work of someone who knows what they're doing. The test suite is real (1,193 tests, 2,241 assertions), and there's not a single `as any` or `@ts-ignore` in the whole tree. That's rare and worth saying out loud.

But the headline features don't deliver what the docstrings, commit messages, and README claim, and three of them are outright broken:

1. **Resumable backfill silently loses all but the first page of data** on any multi-run backfill, and the test that "proves" the feature can't see the bug because it asserts on log events instead of stored records. This is a data-loss ship-blocker.
2. **The flagship "resource-free long pause that resumes on a webhook or timeout" doesn't work end to end.** The functions that resume a pause have no production callers. A paused mission never wakes up.
3. **`npm run typecheck` is red on `main` right now**, and the pre-commit hook can't catch it because it only runs vitest (which skips type errors).

Add a hand-rolled cron parser with a one-character denial-of-service (`*/0` hangs the process), a DSL that can't parse `response.page` against real paginated APIs, and a "rate limiter" that doesn't proactively limit anything, and the picture is clear: this codebase has been built feature-first, with tests that confirm the happy path and docstrings that describe the intended behavior rather than the actual behavior.

The rest of this document is the evidence, ranked by severity, followed by the recurring patterns the team should internalize. The patterns matter more than any single bug.

---

## How this was reviewed

Six independent reviewers swept the codebase in parallel, one per subsystem (interpreter core, language layer, persistence/execution-log, auth/scheduler/control, pause/trace/webhook, and CLI/MCP/OAS/observability). Every finding below has a file and line. Where a reviewer claimed "verified," they reproduced the behavior; the two most consequential findings (backfill data loss, keyword-property parse failure) were independently re-confirmed at the source before publishing.

---

## Critical — data loss, broken flagship features, and trivial DoS

### C1. Resumable backfill drops every record after the first run

`src/interpreter/executor.ts:1481-1510`, `src/interpreter/executor.ts:1169`

The store-effect identity is computed as:

```ts
const fx = effectId(this.logExecutionId, stepId, 0, 'store', step.target);
if (fx && this.appliedEffects.has(fx)) {
  this.log(`Skipping already-applied store to ${step.target} (resume)`);
  return; // <-- the entire store step is skipped
}
```

Every input to that identity is stable across resumed runs: `executionId` is deliberately reused on resume, `stepId` is `${actionName}#${index}`, the attempt is hard-coded `0`, and `target` is the store name. Nothing in the identity describes _which page of data_ is being written. So on run 2, the fetch pulls a different page into `ctx.response`, the store step computes the same `effectId` as run 1, sees it in `appliedEffects`, and skips the write.

A backfill that should persist pages for ids 1-6 persists only ids 1-2. The reviewer drove the exact DSL from `executor-backfill.test.ts` against a real store and got `STORED IDS: [1,2]` where `[1,2,3,4,5,6]` was expected. The other pages were fetched (the API saw offsets 0, 2, 4, 6) and silently discarded.

**The shipped test is blind to this.** `executor-backfill.test.ts:82-86` sums `recordCount` from `page.completed` _log events_, never reading the store. `recordCount` is the _fetched_ count, so the test stays green while all the data is lost. This is the single most important lesson in the whole review: assert on the outcome a user cares about (records in the store), not on a proxy you happen to have handy (events in a log).

**Severity: critical. Silent data loss with no crash, no error, no log line beyond a misleading "Skipping already-applied store."**

### C2. `page.completed` is recorded before the data is persisted

`src/interpreter/fetch-handler.ts:453-460`, `src/execution-log/events.ts:67-79`

`onPage` appends the `page.completed` event and advances `pageProgress` _inside the fetch loop_, while pages are still only in the in-memory `allResults` array. The actual store happens later in a separate step. The event docstring says the page's data is "fetched and persisted" — it's only fetched.

A crash between the final `page.completed` and the store's `effect.applied` advances `pageProgress` past pages that exist only in memory. On resume, the fetch restarts after those pages and they're gone. The crash-injection suite never exercises a backfill-plus-store mission, so this window is untested.

**Severity: critical.**

### C3. The "resource-free long pause" never wakes up

`src/pause/manager.ts:187` (`handleWebhook`), `src/pause/manager.ts:208` (`startMonitoring`)

Both functions that turn a pause back into a running mission have **zero production callers** — grep finds them only in `pause.test.ts`. The executor constructs the pause manager but never registers `onWebhookReceived` to route an inbound webhook into `handleWebhook`, and never calls `startMonitoring()` to poll for expired timeouts.

So a mission that does `pause resumeOn: webhook` registers the webhook, the caller POSTs to it, the server records the event, and then nothing happens — no `pause.resumed`, no continuation. A `pause duration: "7d"` survives a restart on disk but has no running component that ever notices the deadline. The feature is unit-tested in isolation and non-functional in production.

Worse, the two resume paths that _do_ exist corrupt each other (`src/interpreter/executor.ts:464`, `src/pause/log-store.ts:41`). If you trigger a resume through the manager (which appends `pause.resumed`) and then re-invoke `execute({ resumeFrom })`, the fold sees the pause already resumed, the replayed pause step doesn't recognize it's resuming, hits `executePause` again, and throws a fresh `PauseSignal`. Infinite re-pause.

**Severity: critical. The flagship feature of the last several commits does not work.**

### C4. `*/0` in any cron field hangs the process

`src/scheduler/cron-parser.ts:49-69`

```ts
const step = parseInt(stepStr, 10);
for (let i = start; i <= end; i += step) { values.add(i); }
```

`step` is never validated. `"*/0"` gives `step = 0`, so the loop never advances — infinite loop, event loop wedged, process dead. Cron strings come from `.vague` files, so this is a one-character denial of service. A non-numeric step (`"*/x"`) gives `NaN`, an empty value set, and a 2.1-million-iteration, four-year scan on every tick instead.

**Severity: critical.**

### C5. One impossible-but-valid cron starves the entire scheduler

`src/scheduler/cron-parser.ts:207-267`, `src/scheduler/scheduler.ts:155`

`"0 0 31 2 *"` (February 31st, which never occurs) is syntactically valid, passes range checks, and forces `getNextCronRun` through its full four-year scan before throwing. That throw happens inside the un-try-caught `for` loop in `checkAndRun`, so every job registered after the bad one is skipped that tick, and it re-throws every second (default `checkInterval`), burning ~2M iterations per second forever. `setInterval`'s `.catch` swallows it in non-verbose mode, so it's silent.

**Severity: critical. One malformed schedule kills the whole scheduler and pins a CPU.**

### C6. The DSL can't parse property access on real API responses

`src/parser/expressions.ts:259`

```ts
} else if (this.match(TokenType.DOT)) {
  const name = this.consume(TokenType.IDENTIFIER, 'Expected property name').value;
```

After a dot, the parser demands an `IDENTIFIER` token. But `page`, `key`, `cursor`, `offset`, `path`, `from`, `to`, `source`, `store`, `file`, `every`, and ~70 other words are reserved keyword tokens. So `response.page` and `item.key` throw `ParseError: Expected property name` — confirmed empirically by the reviewer and at the source here.

This is an _API-fetch DSL_, and pagination responses almost universally contain `page`, `cursor`, or `offset`. The same collision hits map field names via a different, also-incomplete helper (`src/parser/action-parser.ts:157`), so you can't even emit a field called `key`. And the error message never tells the user the real cause. A large fraction of real APIs are simply unreachable.

The fix is one place: a `consumePropertyName()` that accepts any keyword token's text in name position, where it's unambiguous.

**Severity: critical for usability. The product's core job fails on common inputs.**

---

## High — security holes, exactly-once violations, and resource leaks

### H1. The build is lying: `npm run typecheck` is red on `main`

Three type errors on the committed tree (`src/durability/crash-injection.test.ts:38,119`, `src/sync/log-store.test.ts:61`). Commit `5975252` (66 minutes before this review) grew the `ExecutionLogStore` interface with `listCheckpoints`/`listPauses` but didn't update the crash-injection test double, so the durability proof suite no longer type-checks.

The reason this slipped through is structural: `npm run build` uses `tsconfig.build.json`, which excludes tests, and the pre-commit hook runs `lint-staged` plus `vitest`, not `tsc`. Vitest compiles with esbuild, which strips types without checking them, so the tests run green while the types are broken. CI _does_ have a typecheck job, which means `main`'s CI is either red and being ignored or hasn't run since the drift. Either way, the type safety net has a hole exactly where the durability guarantee is supposed to be proven.

**Severity: high (process). Fix the test doubles, and add `tsc --noEmit` to the pre-commit hook so the gate matches CI.**

### H2. Path interpolation isn't URL-encoded — path injection and SSRF-adjacent

`src/interpreter/evaluator.ts:321-337`, consumed at `src/interpreter/fetch-handler.ts:265`

```ts
return path.replace(/\{([^}]+)\}/g, (_, expr) => String(value ?? ''));
```

Interpolated path values are spliced in raw and then concatenated onto the base URL. Query params go through `URLSearchParams` (encoded); the path does not. A data-controlled `id` of `"1/../../admin"` resolves server-side to `/admin`; `"1?role=admin"` injects a query string; any `/`, `?`, `#`, or space corrupts the target. The codebase already has `sanitizeSegment`/`safeJoin` for filesystem paths but nothing analogous for URLs. Wrap interpolated segments in `encodeURIComponent`.

**Severity: high.**

### H3. Untrusted OpenAPI specs are an SSRF and ReDoS sink

`src/oas/loader.ts:31`, `src/oas/validator.ts:119-121`

`SwaggerParser.dereference(specPath)` will fetch a remote spec and resolve remote `$ref`s by making outbound requests to arbitrary hosts, with no allowlist, no `resolve: { external: false }`, and no size cap. A malicious spec can reach internal metadata endpoints (`http://169.254.169.254/...`). It also dictates the fetch base URL via `servers[0].url` (`src/interpreter/source-manager.ts:157`).

Separately, `new RegExp(schema.pattern).test(value)` compiles an untrusted pattern from the spec and runs it against an untrusted response value, recompiled per value. A catastrophic-backtracking pattern (`(a+)+$`) against an adversarial string hangs the event loop. No timeout, no length cap, no safe-regex check.

**Severity: high.**

### H4. Non-deterministic expressions defeat the exactly-once guarantee

`src/interpreter/evaluator.ts:252` (`now`), `src/interpreter/evaluator.ts:269` (`anyOf` → `Math.random()`)

Effect identity for fetches hashes `JSON.stringify(body)` and store dedup keys on a positional step index. If a fetch body or a value upstream of a store uses `now()` or `anyOf`, the hash or the step count changes between the original run and the replay, so the idempotency key changes and the server sees a brand-new write. `fetch post "/events" body {ts: now()}`, retried after a blip, double-posts despite the idempotency machinery. The runtime should either reject non-deterministic calls in durable contexts or fold their resolved values into the log.

**Severity: high — it silently breaks the headline durability feature.**

### H5. "Deterministic replay" is not implemented

`src/execution-log/events.ts:1-9`, `src/interpreter/executor.ts:1217`

The docstring says recorded outputs are "read back on replay rather than re-derived, so replay is deterministic." But no event carries an output payload — `EffectAppliedEvent` records only an `effectId`, and there's no fetch-response event. On resume the executor re-runs every step unconditionally against a live, mutating API; `prior.completedSteps` is loaded but never consulted to skip anything. This is at-least-once with idempotent writes, not deterministic replay and not exactly-once. `map`/`validate` steps re-run against whatever the API returns the second time.

**Severity: high. The claim and the code disagree.**

### H6. The default durable log is neither fsync'd nor concurrency-safe

`src/execution-log/store.ts:140-166`

`FileExecutionLog.append` uses `appendFile` with no `fsync`, so it survives a process crash (page cache) but not OS or power loss — under the banner of "durable execution." Sequence numbers are assigned from a per-instance cache with no file locking, so two processes appending to the same execution derive the same seq and interleave `O_APPEND` writes, producing duplicate seqs and torn records. This is the default backend the crash-injection "proof" runs against.

**Severity: high.**

### H7. The rate limiter doesn't limit, and its keys never die

`src/auth/rate-limiter.ts:138-164` and `:92-103`

`canProceed` returns `true` unless the server _already told us_ `remaining <= 0`. `remaining` is only ever updated from response headers and never decremented for in-flight requests, so a first burst of 1,000 concurrent callers all see `canProceed === true` and fire. There's no proactive limiting outside `throttle`-mode spacing, and no in-flight accounting, so under concurrency it blows past the server quota every time. Separately, the eviction logic only collects keys whose `resetAt` has already passed, but `recordResponse` always sets `lastRequestAt` and many APIs send no reset header, so those keys are immortal — unbounded growth keyed on `source:endpoint`. The component named "rate limiter" provides neither limiting nor cleanup.

**Severity: high. Decide whether it's a real limiter (add in-flight accounting and single-flight) or rename it to a header recorder.**

### H8. Circuit breaker half-open is a stampede, and the map grows forever

`src/auth/circuit-breaker.ts:133-155`, `:323-336`

In the half-open state, `canProceed` returns `true` for _every_ request, not one probe, so after the reset timeout N concurrent requests all hit the service that just failed — the exact stampede half-open exists to prevent. And `getOrCreateEntry` inserts a permanent entry on every miss and is called from `canProceed`, `getStatus`, `recordSuccess`, and `recordFailure`, with no eviction anywhere. Merely calling `getStatus("unknown")` leaks an entry. With per-endpoint keys this grows without bound. `getAllStatuses` also splits URL keys on `:` (so `https://...` becomes source `https`) and mutates the map while iterating it.

**Severity: high.**

### H9. A slow mission blocks every other scheduled job

`src/scheduler/scheduler.ts:155-172`

`checkAndRun` iterates jobs sequentially and `await`s `runJob`, which awaits the full mission. A 10-minute mission blocks the loop from checking or starting all other jobs for those 10 minutes. `skipIfRunning` only guards re-entry of the same job, not head-of-line blocking across jobs. Dispatch missions without awaiting completion in the check loop.

**Severity: high.**

### H10. The CLI turns every error into a stack-trace crash

`src/cli.ts:409`

`main()` is invoked with no `.catch()`, and the inner try/catch wraps only `fromPath`. Everything before it — env loading, the auth-file read and `JSON.parse`, output-path resolution — runs unguarded, and there's no `process.on('unhandledRejection')` anywhere. `reqon mission.vague --auth ./missing.json` dumps a raw Node stack trace and exits non-deterministically instead of printing "auth file not found." The MCP entry point (`src/mcp/server.ts:586`) gets this right with `main().catch(...)`; the CLI doesn't.

**Severity: high (it's the front door, and it's the first thing every user hits when something's wrong).**

### H11. More unbounded growth and lost wakeups

A cluster of high-severity resource and concurrency bugs that rhyme with the ones above:

- **OTel fetch spans share a single global slot.** `src/observability/otel.ts:331` keys every fetch span as `'fetch:current'`. Two overlapping fetches (parallel stages, pagination) and the second overwrites the first, which then leaks in `activeSpans` forever while the wrong span gets closed. `eventToSpan`, `pendingSpans`, and `spans` all only ever grow (`:78,189,382`) — a steady leak in any daemon.
- **`waitForEvents` has a check-then-wait race.** `src/webhook/server.ts:198-225` checks the store, then registers a waiter, but never re-checks. A webhook arriving in that window resolves the still-empty waiter set, and the new waiter only fires on its full timeout — a lost wakeup that degrades to a multi-day hang reported as `timedOut: true`.
- **`markResumed`'s "exactly once" is in-memory only.** `src/pause/manager.ts:316-359` guards double-resume with an in-process `Set` and a non-atomic load-check-append, in a system whose whole point is spanning process boundaries. Two processes both resume.
- **Trace recording keeps every snapshot in memory even in "streaming" mode.** `src/trace/recorder.ts:213` always pushes to the in-memory array; `streaming: true` doesn't bound it. A mission over 100k items records 200k deep clones and OOMs.
- **`LogBackedPauseStore.load` is O(every log file ever written).** `src/pause/log-store.ts:56` reads and folds the entire log directory on every single pause lookup.

**Severity: high (collectively). See the "unbounded growth" pattern below.**

### H12. Other high-impact language and parser defects

- **`is <type>` rejects the type names it checks.** `src/parser/expressions.ts:181` expects an IDENTIFIER, but `decimal`, `int`, and `date` lex as keyword tokens, so `assume .Total is decimal` — the exact example in `CLAUDE.md` — fails to parse. The project's own canonical snippet doesn't work.
- **Unbounded recursive descent.** No depth guard anywhere in the parser; 50k nested parens throw a raw V8 `RangeError` with no line or column, escaping the structured-error system entirely. A hostile `.vague` file is a trivial DoS.
- **AST nodes carry no source location.** Every Reqon node has only a `type` tag — no line or column. Yet `RuntimeError` is built to render `file:line:column` with a source caret, so it can only ever point at placeholder coordinates. For "a DSL that lives or dies by its error messages," the parser throws away the one thing that makes runtime errors good.

---

## Medium — correctness gaps, weak auth defaults, and silent data mangling

These are real and should be fixed, but they're either narrower in blast radius or require a less common trigger.

| # | Finding | Location |
|---|---------|----------|
| M1 | **Secret redaction is key-name only and over-matches.** Misses secrets in string _values_ (a token inside a URL string); `author`/`sessionCount`/`tokenCount` get wrongly redacted by substring match. Log _messages_ are never redacted, only structured context. | `src/utils/redact.ts:13`, `src/observability/logger.ts:138` |
| M2 | **Pause checkpoints persist all in-scope variables in cleartext, no redaction.** Trace snapshots get redacted; pause checkpoints land in the same log without it. Any token held in a variable at pause time is written in clear (only `0o600` protects it). | `src/interpreter/step-handlers/pause-handler.ts:118` |
| M3 | **Pause variable capture mangles types.** `JSON.parse(JSON.stringify(value))` turns `Date` into a string, `Map`/`Set` into `{}`/`[]`, and a circular ref into the literal string `'[non-serializable]'`. On resume these wrong-typed values are restored and silently misbehave. | `pause-handler.ts:126`, `executor.ts:1601` |
| M4 | **`eventFilter` is decorative.** The filter is applied client-side after the fact; the server fires completion on the first arbitrary POST without evaluating it, and on filter error it _includes_ the event. It gates nothing. | `src/webhook/server.ts:362`, `webhook-handler.ts:131` |
| M5 | **Control and webhook servers only warn when bound off-loopback without a token.** Binding to `0.0.0.0` with no secret serves `/pause`, `/resume`, `/status` unauthenticated after a `console.warn`. The CSRF Origin check does nothing against curl. `/status` exposes execution state (and possibly secrets) unauthenticated by default. Should be a hard refusal to bind. | `src/control/server.ts:62`, `src/webhook/server.ts:74` |
| M6 | **Auth token comparison isn't constant-time.** `header !== expected` short-circuits on the first differing byte — a timing oracle on the shared secret. The webhook server also accepts its secret as a `?token=` query param, which lands in access logs and proxies. | `src/control/server.ts:224`, `src/webhook/server.ts:444` |
| M7 | **MCP server runs untrusted (LLM-supplied) missions with no timeout or resource bound.** `dryRun` stops network and filesystem effects but not CPU or memory, so a big `for` loop or `pause` wedges the stdio server. `register_store` with `type: file` also writes to disk regardless of `allowEffects`, violating the advertised sandbox. | `src/mcp/server.ts:283`, `:414` |
| M8 | **OAuth2 refresh races and loses tokens.** The single-flight guard is per-instance, so two instances sharing a `connectionId` both refresh and brick the connection under refresh-token rotation. If `store.set` fails after the server rotated the token, the new token is lost and the old one is dead — unrecoverable. Tokens with no `expiresAt` are never proactively refreshed. | `src/auth/oauth2-provider.ts:46,106,112` |
| M9 | **Cron parser is fragile beyond `*/0`.** Day-of-week `7` (Sunday) is rejected though standard cron accepts it; `NaN` from a bad field passes the range check and yields a four-year scan; delta-style `Reset` headers (`60`) are parsed as epoch 1970, silently disabling the limiter. `once` schedules only match within ±1s of `runAt`, so a busy loop or a sleeping host misses them entirely. | `src/scheduler/cron-parser.ts:21,76,371`, `rate-limiter.ts:409` |
| M10 | **Comparison operators throw on missing fields.** `<`, `>`, `<=`, `>=` coerce via `toNumber`, which _throws_ on `null`/`undefined`. `for x in items where x.score > 5` crashes the whole stage the moment one item lacks `score` — and real data routinely has missing fields. A `where` that should exclude a record kills the mission instead. | `src/interpreter/evaluator.ts:163,343` |
| M11 | **`env()` reads arbitrary env vars from a data-driven argument.** `env(response.someField)` lets fetched data choose which environment variable (e.g. `AWS_SECRET_ACCESS_KEY`) is read and potentially exfiltrated. No allowlist. | `src/interpreter/evaluator.ts:254` |
| M12 | **Incremental-sync checkpoint advances by client wall-clock.** `recordCheckpoint` tries the data's own timestamp but indexes an array by field name, gets `undefined`, and always falls back to `fetchStartedAt`. With any clock skew, boundary records are missed or refetched. | `src/interpreter/fetch-handler.ts:204` |
| M13 | **`pageSize <= 0` fetches the same page 100 times.** Offset is `page * pageSize` (always 0), and `hasMore: items.length >= pageSize` is always true, so it loops to the 100-page cap re-accumulating page 1. No validation that `pageSize > 0`. | `src/interpreter/pagination.ts:182` |
| M14 | **Retry-After and token refresh mishandle errors.** `parseInt` on an HTTP-date `Retry-After` gives `NaN` → `sleep(NaN)` → a tight retry loop hammering an overloaded server; a hostile `999999` sleeps 277 hours uncapped. `doRefresh` never checks `response.ok`, so an `invalid_grant` body sets `Bearer undefined` and loops. A 429 on the final attempt throws the generic "Request failed after all retries" with `lastError` null. | `src/interpreter/http.ts:131,139,470` |
| M15 | **OAS edge cases crash or misbehave.** `allOf`/`oneOf`/`anyOf` recurse without a depth increment or the declared-but-unused cycle guard, so a self-referential spec stack-overflows in dry-run. `servers[].url` templating (`{region}`) is returned raw, producing malformed fetch URLs. | `src/oas/mock-generator.ts:65`, `src/oas/loader.ts:48` |
| M16 | **Observability metrics are quietly wrong.** `event.duration` is the gap since the previous event of any type, not the operation's duration. `pagesFetched` is always `undefined`. `for`-loop `itemsFailed` is always `0` (the increment is immediately followed by a throw). Trace/span IDs use `Math.random()`, not crypto, and can collide or emit the all-zero ID. | `src/observability/events.ts:386`, `fetch-handler.ts:135`, `for-handler.ts:55`, `otel.ts:64` |

---

## Low — papercuts, dead code, and missing validation

Worth a cleanup pass; none is urgent on its own.

- **`basic` and `api_key` credentials are silently dropped.** `createAuthProvider` only handles bearer and oauth2, so `type: 'basic'`/`'api_key'` sources go out unauthenticated. (`src/interpreter/source-manager.ts:120`)
- **Missing required env var resolves to empty string.** A required `${VAR}` with no value becomes `''`, so requests go out with `Authorization: Bearer ` instead of erroring. (`src/auth/credentials.ts:99`)
- **Scheduler state is written non-atomically.** `writeFile(state.json)` with no temp-and-rename; a crash mid-write corrupts it and `loadState` silently starts fresh, losing all run history. (`src/scheduler/scheduler.ts:382`)
- **FileStore has no locking** — last-writer-wins between instances on the same path. `immediate` mode rewrites the whole file on every `set()` (O(n²) I/O). (`src/stores/file.ts:143,163`)
- **SQLite log oversells multi-writer safety.** No seq-collision retry (unlike the Postgres adapter), and `synchronous = NORMAL` isn't power-durable despite the "survive a crash" comment. (`src/execution-log/sqlite-store.ts:64`)
- **CLI flag handling is positional-only.** `reqon --verbose mission.vague` treats `--verbose` as the file path. Numeric flags (`--webhook-port abc`) parse to `NaN` and flow straight into the server. (`src/cli.ts:84,98`)
- **`deepMerge` reassigns the result's prototype** on a JSON `"__proto__"` key (not globally exploitable thanks to the spread, but it should skip `__proto__`/`constructor`). (`src/utils/deep-merge.ts:21`)
- **`reqon.parse`/`query_store` skip zod validation** and `query_store` has no max `limit`, so an LLM can pull the whole store. (`src/mcp/server.ts:317,347`)
- **`captureStores` is a hard-coded placeholder** (`itemCount: -1`), so every trace's store snapshot is meaningless. `truncateForTrace` only truncates the top level, so nested payloads stay unbounded. (`src/trace/recorder.ts:188`, `state.ts:162`)
- **OTLP `intValue` is emitted for floats**, which backends reject or truncate. The auto-flush `setInterval` isn't `unref()`'d, so it keeps a one-shot CLI alive. (`src/observability/otel.ts:166,438`)
- **README advertises `sql` and `nosql` store types** (`store name: sql("table")`) that the factory throws "not implemented" for unless you opt into a file fallback. At least the error is honest. (`src/stores/factory.ts:71`)
- **Webhook 404-vs-401 ordering leaks** which registration paths exist — an enumeration oracle. Custom `wait path:` values are guessable, unlike the random-UUID default. (`src/webhook/server.ts:294`)

---

## The patterns the team should take away

The individual bugs matter less than the habits that produced them. Six themes run through this codebase, and fixing the habit is worth more than fixing any one finding.

### 1. Tests assert on proxies, not outcomes

The backfill test sums log events instead of reading the store, so it's green while every record after page 1 is lost (C1). The durability suite never runs a backfill-plus-store mission, so the crash window in C2 is invisible. `pagesFetched`, `itemsFailed`, and `event.duration` are all wrong and no test noticed, because no test asserts on them.

**The lesson:** test the thing the user observes. If the feature is "data ends up in the store," the assertion is "read the store and check the records" — never "count the events we happened to emit along the way." A test that can't fail when the feature is broken is worse than no test, because it buys false confidence.

### 2. Docstrings and commit messages describe intent, not behavior

"Replay is deterministic" (it re-runs everything live). "Fetched and persisted" (only fetched). "Resource-free pause that resumes on a webhook" (never wakes up). "Cleanup to prevent memory leaks" (collects almost nothing). Every one of these is a comment that asserts a guarantee the code doesn't provide.

**The lesson:** a comment that claims a guarantee is a liability unless a test enforces it. If you write "exactly once" or "deterministic" or "durable," there should be a test named after that word that fails when it stops being true. Otherwise the comment slowly becomes a lie that the next engineer trusts.

### 3. In-memory coordination in a system built to survive process boundaries

The pause-resume `Set`, the circuit-breaker map, the rate-limiter map, the per-instance sequence counter, and the OAuth `refreshPromise` are all in-process state. But the entire premise of durable execution, resource-free pauses, and multi-node logs is that work spans processes and restarts. The moment a second process or a restart enters the picture — which is the whole point — these guarantees evaporate.

**The lesson:** coordination has to be as durable as the thing it coordinates. If your model is multi-process, "exactly once" lives in the database with a compare-and-set, not in a JavaScript `Set`. Match the durability of the guard to the durability of the claim.

### 4. Components wired but never connected

`handleWebhook` and `startMonitoring` are fully implemented, fully unit-tested, and called by nothing. The unit tests pass in isolation and prove nothing about whether a paused mission actually resumes, because no test drives the real seam: pause a mission, deliver a webhook over HTTP, observe the tail run exactly once.

**The lesson:** unit tests verify a unit; they say nothing about the wiring between units. Every feature needs at least one integration test that exercises the real path end to end, through the same entry point a user would hit. That test is the only thing that would have caught C3.

### 5. Every map and array needs an eviction story before it ships

The circuit-breaker map, the rate-limiter map, the OTel span maps, the trace snapshot array, and the append-only log all grow without bound. In a CLI run that's invisible; in the daemon this project is clearly heading toward, it's a slow OOM.

**The lesson:** any structure keyed by high-cardinality data (URLs, endpoints, ids) needs a defined eviction or compaction policy at the moment you add it. "It's fine for now" is how you get a memory leak that only shows up in production after a week of uptime.

### 6. Hand-rolled parsers and unvalidated input at the boundary

The cron parser hangs on `*/0`, scans for four years on an impossible date, and rejects valid Sunday `7`. The expression parser stack-overflows on deep nesting. `Retry-After`, OAS `pattern`, `pageSize`, and numeric CLI flags all flow in unvalidated. Each is input from outside the trust boundary hitting code that assumes it's well-formed.

**The lesson:** validate at the boundary, hard, and fail with a real error. Hand-rolled parsers especially need explicit guards (depth limits, step `>= 1`, reject `NaN`) and ideally a fuzz test, because the inputs that break them are exactly the ones no one types by hand.

### 7. A 1,770-line executor and six copies of the same parser

`executor.ts` is a god class; its two stage methods are ~95% identical event-and-state boilerplate, and there are at least six near-identical option-key parsers. This isn't a defect by itself, but it's _where_ defects breed: the `headers` option and the `validate` message field are dead specifically because one copy forgot a case the others have. Duplication doesn't just cost reading time; it guarantees the copies will drift, and the drift is the bug.

**The lesson:** when you've written the same 20-line shape three times, the third time is the signal to extract it. A single `parseOptionsBlock(handlers)` and a single `runStage(kind)` would delete hundreds of lines and close the gap where these divergence bugs live.

---

## What's genuinely solid (so you know it was checked)

It's not all bad, and it's worth knowing what to protect:

- **`writeFileAtomic`** (`src/utils/file.ts:38`) is correct: temp file, `fsync`, atomic rename, cleanup. `readJsonFile` correctly distinguishes ENOENT from corruption instead of treating a torn file as empty.
- **`safeJoin`/`sanitizeSegment`** (`src/utils/path.ts:46`) genuinely block path traversal — the "ironic vulnerable path util" turned out not to be vulnerable.
- **PostgREST where-clause handling** (`src/stores/postgrest.ts:99`) validates fields and escapes values properly. The SQL identifier guard is correct.
- **The torn-log heal and torn-line skip** (`src/execution-log/store.ts:151,206`) are sound; the single-writer, process-crash case really is robust.
- **Postgres seq-collision retry** (`src/execution-log/postgres-store.ts:98`) is the right pattern (the SQLite adapter should copy it).
- **`long-timeout.ts`** correctly handles the 32-bit `setTimeout` overflow.
- **The MCP sandbox's path confinement and default-deny** (`src/mcp/sandbox.ts`) are well-reasoned.
- **Zero `as any`, zero `@ts-ignore`, strict mode on.** Whoever set the TypeScript bar held it. Don't let it slip.

---

## If you fix nothing else, fix these first

1. **C1 / C2 — backfill data loss.** Put the page or a content hash into the store effect identity, persist before advancing `pageProgress`, and rewrite the backfill test to assert on store contents. This is losing user data today.
2. **C3 — wire up pause resume,** or pull the feature until it works, and add the end-to-end integration test that would have caught it.
3. **C4 / C5 — validate cron at parse time:** `step >= 1`, reject `NaN`, allow DOW `7`, reject empty ranges, and wrap each job's check in try/catch so one bad schedule can't starve the rest.
4. **C6 — one `consumePropertyName()`** that accepts keyword tokens after a dot. Small change, unblocks a huge class of real APIs.
5. **H1 — add `tsc --noEmit` to the pre-commit hook** so the gate matches CI, then fix the red typecheck.
6. **H2 / H3 — `encodeURIComponent` interpolated paths** and disable external `$ref` resolution plus bound regex input in the OAS layer.

The bones are good. The problem is a gap between what the code claims and what it does, and a test suite that confirms the claims instead of the behavior. Close that gap and this becomes a solid system.

---

## Fixes applied

What landed on `fix/code-review-findings`, with a regression test for each. Numbering matches the C/H/M sections above.

### Fixed

| # | Finding | Fix |
|---|---------|-----|
| C1 | Backfill drops all but the first page | Store-effect identity now hashes the payload, so each page is a distinct effect. Regression test asserts on **store contents**, not log events. |
| C3 | Pause re-resume infinite loop | Executor folds `resumedPauseId` out of the log and replays past an already-resumed pause instead of creating a new one. |
| C4 | `*/0` cron hang | Cron step validated as an integer `>= 1`; `*/0` and `*/x` throw at parse time. |
| C5 | One bad cron starves the scheduler | Each job's check is wrapped in try/catch; missions dispatched without `await` (also fixes H9 head-of-line blocking); impossible day/month combos fail fast. |
| C6 | `response.page` won't parse | Single `consumeName()` accepts keyword tokens in name/property position; fixes property access, map field names, and `is <type>`. |
| H1 | Red typecheck on `main` | Test doubles realigned to the `ExecutionLogStore` interface; `recordSync` signature fixed. |
| H2 | Path-param injection | Interpolated path values are `encodeURIComponent`-escaped. |
| H7 | Rate limiter never evicts | Evicts by `lastRequestAt` staleness regardless of reset header. |
| H8 | Circuit-breaker half-open stampede + leak | Single in-flight probe in half-open; read paths no longer create entries; `evictStale` added; `getAllStatuses` no longer corrupts URL keys. |
| H11 | Trace memory + OTel span leaks | Streamed snapshots bounded to a recent window; OTel fetch spans keyed per source+path; stage/step span entries deleted on end. |
| H10 | CLI stack-trace crashes | `main().catch()` + `unhandledRejection` guard; auth-file errors become clean messages. |
| H3 | OAS SSRF + ReDoS | External `$ref` resolution off by default; pattern input length-bounded and regexes cached. |
| M6 | Non-constant-time auth + off-loopback warn | `crypto.timingSafeEqual`; control server hard-refuses to bind a non-loopback host with no token. |
| M8 | OAuth refresh swallows errors | Non-2xx (and 2xx-without-token) refreshes throw instead of setting `Bearer undefined`. |
| M9 | Cron compat | DOW `7` = Sunday, `NaN` rejected, reversed ranges rejected, missed `once` ticks still fire. |
| M10 | Comparisons throw on missing fields | `<`/`>`/`<=`/`>=` exclude missing/non-numeric operands instead of aborting the stage. |
| M11 | `env()` data-driven exfil | `env()` requires a string-literal name. |
| M13 | `pageSize <= 0` infinite re-fetch | Rejected at the strategy factory. |
| M14 | Retry-After / refresh handling | Parses delta-seconds or HTTP-date, clamps to `maxDelay`; 429 on the final attempt surfaces a real `FetchError`. |
| M15 | OAS mock recursion / server templating | `allOf`/`oneOf`/`anyOf` recurse with a depth bound; `{variable}` server URLs resolved. |
| M16 | Wrong metrics + weak IDs | Fabricated per-event `duration` removed; trace/span IDs use `crypto.randomBytes`. |
| M7 | MCP untrusted-mission DoS | Execution timeout around untrusted missions; file-store registration gated behind `allowEffects`. |
| L | Misc | Unset required `${VAR}` now throws; scheduler state written atomically. |

### Deliberately deferred (with reasons)

These need a dedicated change with its own design and integration test; a rushed patch would have made them worse.

- **C2 — page-completed-before-persist crash window.** A correct fix defers the resume-cursor advance until after the downstream store step, which restructures how backfill pagination and the store step interact. Documented honestly in the `page.completed` type; the cheap docstring lie is gone.
- **C3 (the dead wiring half).** The corruption is fixed, but `handleWebhook`/`startMonitoring` still need an orchestration layer to actually re-invoke a paused mission. That's a feature, not a patch, and needs an end-to-end test that delivers a real webhook over HTTP.
- **H4 — non-determinism vs exactly-once.** Detecting `now()`/`anyOf` in durable contexts generally is non-trivial; left documented.
- **H5/H6 — replay determinism claim, file-log fsync.** Event-sourced replay-of-outputs and power-loss durability are design-level changes to the log format.
- **M1/M2/M3 — redaction and pause checkpoint typing.** Tightening the redaction denylist risks under-redacting real secrets (over-redaction is the safer failure), and pause checkpoints can't both redact a secret and restore it on resume; both are inherent tradeoffs worth a deliberate decision, not a drive-by edit.
- **`basic`/`api_key` providers.** Lives in a separate credential path; needs the real credential schema to implement correctly.
