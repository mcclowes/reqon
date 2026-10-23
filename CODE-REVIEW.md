# Reqon: holistic code review

**Reviewer:** principal engineer, first two days on the codebase
**Commit:** `139080f` (main)
**Scope:** all of `src/` (227 files, ~26.7k LOC source, ~25.4k LOC test)
**Date:** 2026-07-26

---

## Verdict

This codebase is unusually well-commented, has 1,434 passing tests, clean `tsc --noEmit`, and zero lint errors. Somebody has been thinking hard here — the comments explaining *why* a decision was made (rather than *what* the line does) are better than most production code I've read.

And yet I would not put a customer's data behind it today.

The reason is a pattern, not a bug: **this system prefers to keep going quietly over stopping loudly.** Over and over, a condition that means "I have lost your data" or "I could not authenticate you" is handled by logging a line and returning a plausible-looking value. The tests pass because the tests assert the happy path returns the right thing; nothing asserts that the sad path is *visible*.

The single worst example, verified below: a paginated incremental sync that hits the hardcoded 100-page cap silently truncates the result, and then **advances the sync checkpoint past the records it never fetched.** The run reports `success: true`. The data is gone forever, and no operator will ever know.

There are 59 findings below. Roughly a third are already tracked as GitHub issues, which I've cross-referenced — credit where due, the team knows about several of these. The rest are new.

**What I'd want changed before this ships to anyone who cares about their data:** the four S1 findings. They're all a day or two of work each. The architecture is fine; the failure semantics are not.

---

## How to read this

Every finding has the same shape:

- **Where** — file and line, so you can go look
- **What happens** — the concrete failure, not an abstraction
- **Why it's wrong** — the reasoning
- **The lesson** — the transferable principle, because you will write this code again in a different file next month

Severity:

| | Meaning |
|---|---|
| **S1** | Silent data loss, silent auth bypass, or a permanent wedge. Fix before anyone depends on this. |
| **S2** | Wrong behaviour under conditions that happen in normal operation. |
| **S3** | Wrong under unusual conditions, or right but fragile. |
| **S4** | Smells, dead code, inconsistency. Cheap to fix, worth fixing. |

Findings marked 🔖 are **already tracked** in GitHub. I've kept them because they matter to the overall picture, but the team found them first.

Everything I call a bug in S1 and S2, I reproduced. The reproductions are in [Appendix A](#appendix-a-reproductions) — 15 tests, all passing against `main`, each asserting the *current, broken* behaviour.

---

# Part 1 — the architectural critique

Before the line-by-line, five themes. If you only fix the themes, most of the individual findings evaporate.

## Theme 1: silence is the default failure mode

This is the defining problem. Grep the codebase for `this.deps.log(` in an error path and count how many are followed by a `return` rather than a `throw`.

Concrete instances, all verified:

- Pagination hits its cap → `log('Warning: pagination limit reached')` → returns a partial array that is indistinguishable from a complete one (`fetch-handler.ts:478`)
- The array-field heuristic guesses wrong → returns `[]` → "zero new records, all good" (`pagination.ts:144`)
- `auth: basic` is configured → `createAuthProvider` returns `undefined` → the request goes out **unauthenticated** (`source-manager.ts:197`) 🔖 #200
- `env("MISSING_KEY")` → returns `''` → `Authorization: Bearer ` → a 401 storm that looks like the API's fault (`evaluator.ts:337`)
- `{id}` doesn't resolve → `/users/` instead of `/users/42` (`evaluator.ts:422`)
- A date comparison → `false`, always, in both directions (`evaluator.ts:471`)
- `trace: full` without `persistState` → tracing never starts, no warning (`executor.ts:506`)

**The lesson.** There are exactly three honest things to do when you can't complete an operation: do it, fail loudly, or return a value that *the type system forces the caller to handle*. "Log and return something plausible" is none of them — it converts a loud failure into a quiet corruption, and quiet corruption is the expensive kind. You find it six months later in a customer's reconciliation report.

A useful rule: **if the log line contains the word "warning", ask why it isn't a thrown error or a field on the return type.** Usually the honest answer is "because then I'd have to handle it at the call site", which is precisely the point.

For the truncation case specifically, the right shape is:

```ts
export interface FetchResult {
  data: unknown;
  checkpointKey?: string;
  status?: number;
  /** Set when pagination stopped early. A checkpoint MUST NOT advance past a
   *  truncated result — the un-fetched records would never be seen again. */
  truncated?: { reason: 'page-cap' | 'item-cap'; pagesFetched: number };
}
```

...and then `executor.ts` refuses to flush the pending checkpoint when `truncated` is set. That's a ~15-line fix for the worst bug in the codebase.

## Theme 2: the durability story does not survive contact with the evaluator

There's a lot of serious machinery here: an append-only execution log, effect IDs, replay-based resume, idempotency keys, crash-injection tests. That's a real investment, and `execution-log/` is one of the better-built parts of the repo.

But replay-based resume requires **determinism**, and the evaluator is not deterministic:

```ts
// evaluator.ts:324
case 'now':
  return new Date().toISOString();

// evaluator.ts:352
return collection[Math.floor(Math.random() * collection.length)];
```

Neither value is recorded in the log. Replay a mission and `now()` returns a different answer; `anyOf` picks a different element. Any effect ID derived downstream from those values differs, so dedup misses and the effect re-applies. The shipped example `examples/incremental-sync/sync.vague` uses `key: now()` as a **store key** — replay writes a second row.

This isn't a small bug, it's a category error: the DSL exposes non-deterministic primitives and the runtime promises deterministic replay. One of those has to give.

The team knows the guarantees are overstated (🔖 #199), which is the right instinct. The fix is standard event-sourcing practice: non-deterministic primitives read from the log on replay and append to it on first execution. `now()` becomes "the timestamp recorded for this step ID", not "the wall clock".

Related, and also part of #199: `writeFileAtomic` (`utils/file.ts`) fsyncs the temp file but **never fsyncs the parent directory** after `rename`. On ext4 with the wrong mount options, a crash can lose the rename even though the data was synced. If you're going to claim crash durability, you have to sync the directory entry too.

**The lesson.** Determinism is a whole-system property. You can't bolt it onto the persistence layer while the expression layer reads the clock. When you design for replay, write down the list of non-deterministic inputs — clock, randomness, environment, network — and make each one an explicit, recorded input to the computation.

## Theme 3: heuristics where there should be contracts

```ts
// pagination.ts:144 — how the framework decides which field holds your records
for (const key of Object.keys(data)) {
  if (Array.isArray(data[key])) {
    const items = data[key] as unknown[];
    cache.set(cacheKey, key);
    return { items, hasMore: items.length >= pageSize };
  }
}
```

The first array-valued key wins. For `{"warnings": [], "data": [...100 records...]}` — an extremely common envelope — it locks onto `warnings`, returns zero items, decides there are no more pages, and stops. Verified in Appendix A: **the fetch returns `[]` and reports success.**

It then *caches* that wrong choice, so it stays wrong for the rest of the run.

The cursor strategy has a `cursorPath` config. There is no `itemsPath`. The framework lets you declare where the cursor lives but guesses where the data lives, which is exactly backwards — the cursor is recoverable, the data is not.

Same pattern elsewhere:

```ts
// fetch-handler.ts:181 — classifying an error by grepping its message
private isRetryableError(error: unknown): boolean {
  const message = error.message.toLowerCase();
  return message.includes('timeout') || message.includes('network') ||
         message.includes('rate limit') || message.includes('429') || ...
}
```

There is a `FetchError` class with a structured `statusCode` field three files away. This function ignores it and does substring matching on human-readable prose — so an API that returns `{"error": "no results for query '429'"}` gets classified as retryable, and any future change to an error message silently changes retry behaviour.

**The lesson.** A heuristic is a guess that runs in production forever. Every one you write is a decision to be *probably* right instead of *verifiably* right. Sometimes that's the correct trade — but make it consciously, put the escape hatch in the config, and make the guess observable. Here: add `itemsPath`, keep the heuristic as a fallback, and log loudly when the fallback is what fired.

And when you already have structured data (an error class with a status code), never re-derive it from a string. The string is a rendering of the truth, not the truth.

## Theme 4: `executor.ts` is a god class

1,856 lines. It holds 27 instance fields. It constructs `SourceManager` and `StoreManager` **twice** in the constructor and throws the first pair away:

```ts
// executor.ts:300 — first construction
this.sourceManager = new SourceManager({ auth, missionDir, ... }, { rateLimiter, circuitBreaker });
this.storeManager = new StoreManager({ customStores, developmentMode, dataDir });

// ...80 lines of callback wiring...

// executor.ts:402 — same thing again, now with a log function
this.sourceManager = new SourceManager({ auth, missionDir, ..., log: (msg) => this.log(msg) }, ...);
this.storeManager = new StoreManager({ ..., log: (msg) => this.log(msg) });
```

That's not a performance problem; it's a *diagnostic* problem. It means nobody can hold the constructor in their head any more, so a duplicated 15-line block survives code review. When a file gets to the point where you can duplicate object construction without anyone noticing, the file has already failed.

The step handlers were extracted into `step-handlers/` — good instinct, right direction. But the executor still does mission orchestration, action retry, step dispatch, effect dedup, checkpoint flushing, debug snapshotting, trace recording, pause handling, log appending, event emission, and control-server sync. Those are at least four different jobs.

Symptoms visible in the file:

- An orphaned JSDoc comment at `executor.ts:1574` describes `storeContentHash`, but `loadResumingPause` was inserted between the comment and its function. Both now sit under the wrong doc. Nobody noticed because nobody reads 1,856 lines top to bottom.
- `getStepType` (`executor.ts:1764`) maps nine step types. There are ten. `ApplyStep` is missing, so **every `apply` step is reported to your observability stack as a `fetch`.** The `StepType` union in `observability/events.ts:81` doesn't even contain `'apply'`, so the type system couldn't catch it.

**The lesson.** File length is a proxy, not the disease. The disease is *number of reasons to change*. Ask of any class: if I change the retry policy, do I touch this file? If I change the trace format? If I add a step type? If the answer is yes to more than one or two, it's doing more than one job. Split by axis of change, not by line count.

The concrete tell here: `getStepType` is a mapping table that must be updated whenever a step type is added, and it lives 1,700 lines away from the `switch` that dispatches step types. Those two things should be adjacent, or better, be the same thing — a single registry keyed by step type, holding both the handler and the metadata. Then adding a step type is one edit and the compiler enforces exhaustiveness.

## Theme 5: two resilience mechanisms that don't defend the failure they're built for

The rate limiter and circuit breaker are the most carefully-commented code in the repo. The comments are genuinely instructive — the one at `rate-limiter.ts:230` explaining why reservation beats measurement for pacing concurrent callers is better than what you'd find in most libraries.

But both have a hole in exactly the case they exist for.

**The circuit breaker wedges permanently.** In half-open, one probe request is admitted (`circuit-breaker.ts:189`). If that probe comes back 4xx, `http.ts:285` throws before calling `recordFailure`. Even if it did call it, 403 isn't in `failureStatusCodes`, so `recordFailure` returns early at line 278 — **without releasing `probeInFlight`**. The circuit is now in half-open with the probe slot taken, forever. Not open (so no `resetTimeout` will ever re-arm it), not closed. Every subsequent request is rejected for the life of the process.

The trigger is mundane: an API that starts returning 401 after a token expires, or 403 after a key rotation.

**The rate limiter has no defence against a 4xx storm either.** `http.ts` only calls `recordFailure` for `>= 500` and network errors. An API returning 403 to every request is invisible to the breaker. Combine that with the default `for` loop policy of `onError: continue` (`for-handler.ts:237`) and you get a mission that hammers a rejecting API a million times and finishes reporting `success: true` with an empty store.

To the team's credit, `toleratedFailures` was added to `ExecutionResult` precisely to stop that being invisible — the comment at `executor.ts:256` shows someone thought about this exact scenario. But it's a report, not a brake. Nothing stops the loop.

**The lesson.** When you build a safety mechanism, write down the failure it's supposed to catch, then write a test that *causes that failure* and asserts the mechanism fired. Not a unit test of the mechanism's state machine — an end-to-end test of the scenario. "Circuit breaker opens after five 500s" is a test of the implementation. "An API that starts 403ing everything does not get a million requests" is a test of the requirement, and it's the one that fails here.

A state machine with a resource (the probe slot) needs the release in a `finally`, or needs to be modelled so that no path can hold the resource without a matching release. `probeInFlight = true` is set in one method and cleared in three others, with an early-return path in between. That's not a state machine, that's a lock with a leak.

---

# Part 2 — findings

## S1 — fix before anyone depends on this

### S1-1. Pagination truncates silently, then the sync checkpoint advances past the gap

**Where:** `interpreter/fetch-handler.ts:19,26,450-454,478-481` → `interpreter/executor.ts:1401-1417`

**What happens.** `MAX_PAGINATION_PAGES = 100` and `MAX_PAGINATION_ITEMS = 100_000` are module constants with no config override. When either is hit, `executePaginated` logs a line, sets `hasMore = false`, and returns the partial array. `FetchResult` carries no indication of truncation. Back in the executor, the deferred checkpoint fires after the store step and advances the sync watermark to the time the fetch *started*.

Next run asks the API for records changed since that watermark. Everything on pages 101+ that predates it is never fetched again.

Verified — an endless source with `pageSize: 10` returns exactly 1,000 records, no error, no event, no field on the result, and the checkpoint advances anyway.

**Why it's wrong.** A cap is a correct engineering decision — unbounded pagination is a real memory risk. Truncating *without telling the caller* is not, and advancing a durability watermark past data you know you didn't read is a data-integrity violation, not a bug in a feature.

Note the asymmetry: the backfill path already gets this right. `stoppedByCap` is threaded carefully so `done: false` is recorded and a later resume continues (`fetch-handler.ts:459-465`). Somebody understood the hazard exactly — and only fixed it on the path where a resume exists. The non-backfill path, which is the default and what every shipped example uses, has no such protection.

**The lesson.** When you find yourself writing a safety limit, ask: *what does the caller do differently when this fires?* If the answer is "nothing, because they can't tell", the limit is a data-loss mechanism wearing a safety-limit costume. Make the limit part of the return type. And whenever a watermark, cursor, or checkpoint advances, ask what would have to be true for that advance to be a lie.

**Fix:** add `truncated` to `FetchResult`; refuse to flush pending checkpoints when set; make both caps configurable; emit an event.

### S1-2. Circuit breaker wedges permanently in half-open after a 4xx probe

**Where:** `auth/circuit-breaker.ts:189-193, 278-280` + `interpreter/http.ts:285-287`

**What happens.** Described in Theme 5. Verified: after tripping the circuit and admitting a probe that returns 403, `canProceed` returns `false` forever — including after ten times the `resetTimeout` has elapsed.

**Why it's wrong.** A circuit breaker's entire purpose is to *recover*. One that can enter a state it never leaves is worse than no breaker, because the failure is now permanent and attributed to your framework rather than to the flaky upstream.

**The lesson.** Any state machine holding an exclusive resource needs the release on every exit path — including the early `return` you add three months later for an unrelated reason. Prefer designs where the resource can't leak: pass a release callback to the caller, or have the probe slot expire on a timestamp rather than a boolean. `probeInFlight: boolean` should probably be `probeStartedAt?: number`, with admission checking `now - probeStartedAt > probeTimeout`. Then a lost release is self-healing.

**Fix:** release `probeInFlight` in `recordFailure`'s early-return; have `http.ts` report 4xx to the breaker as an ignored-but-observed outcome; add the timestamp-based probe slot as defence in depth.

### S1-3. Comparison operators cannot compare dates or strings

**Where:** `interpreter/evaluator.ts:454-485`

**What happens.** `toComparable` coerces via `Number()`. `Number('2026-01-01T00:00:00Z')` is `NaN`, so `compareNumbers` returns `false`. Verified in both directions:

```
'2026-01-02T00:00:00Z' > '2026-01-01T00:00:00Z'  →  false
'2026-01-01T00:00:00Z' > '2026-01-02T00:00:00Z'  →  false
```

So `where .updated_at > lastSync` — the single most common filter in an incremental sync tool — silently matches nothing. `where .name < "m"` likewise.

It also breaks trichotomy: `'banana' < 'apple'` is `false` **and** `'banana' >= 'apple'` is `false`. `not (a < b)` is not equivalent to `a >= b` in this language, which will produce genuinely baffling bug reports.

**Why it's wrong.** The doc comment at line 462 defends returning `false` for missing fields, and that reasoning is sound — real API data omits fields and one absence shouldn't abort a stage. But it conflates *absent* with *not a number*. A date string is present and perfectly comparable; the evaluator just doesn't know how.

**The lesson.** When you write a coercion function, enumerate the types your domain actually carries before you decide what to coerce *to*. This is a tool for pulling JSON off HTTP APIs. The types it will see are string, number, boolean, null, and ISO-8601-in-a-string. Building comparison on `Number()` handles two of those.

Watch for the specific smell where a lenient fallback (`return false`) is justified by one scenario (missing field) and then silently applied to a second, unrelated one (wrong type). Those need different answers: missing → `false`; present-but-incomparable → throw, because it's a bug in the mission the author can fix.

**Fix:** compare same-typed operands natively (string vs string lexicographically, ISO-8601 as dates via `Date.parse`, number vs number numerically); keep `false` only for genuinely absent operands; throw on a real type mismatch.

### S1-4. `auth: basic` and `auth: api_key` send unauthenticated requests 🔖 #200

**Where:** `interpreter/source-manager.ts:197-218`, `parser/source-parser.ts:287-290`

**What happens.** The parser accepts `basic` and `api_key`. `createAuthProvider` handles only `bearer` and `oauth2` and returns `undefined` otherwise. `HttpClient` treats `undefined` auth as "no credentials" and sends the request anyway.

Same fail-open path when the type *is* `bearer` but the token is empty: `if (authConfig.type === 'bearer' && authConfig.token)` — an empty token falls through to `undefined`.

`CLAUDE.md` lists all four schemes as supported.

**Why it's wrong.** Auth is the one place where failing open is never acceptable. "I was told to authenticate, I couldn't work out how, so I sent it without credentials" is the worst available outcome — worse than crashing, because in a mission with `onError: continue` it produces thousands of unauthenticated requests to a third party.

**The lesson.** Configured-but-unimplemented must be a startup error, not a runtime shrug. And the structural fix is to make it unrepresentable: the parser's auth type union and the runtime's auth type union should be **the same type**. They're currently two independently-maintained string unions (`'bearer' | 'oauth2' | 'basic' | 'api_key'` in the parser, `'bearer' | 'oauth2' | 'none'` in `source-manager.ts:23`), so the compiler can't tell you they've diverged. One shared union plus an exhaustive `switch` with a `never` check, and this class of bug stops existing.

**Fix:** share the union; exhaustive switch; throw on unimplemented at source-initialisation time.

---

## S2 — wrong under normal operating conditions

### S2-1. Pagination guesses which field holds your records

`pagination.ts:144-153`. Covered in Theme 3. Verified: `{warnings: [], data: [...]}` yields `[]`. **Fix:** add an `itemsPath` config to `PaginationConfig`.

### S2-2. A malformed rate-limit header permanently disables throttling

`auth/rate-limiter.ts:509` → `264-271` → `252-260`. `parseInt('unknown', 10)` is `NaN`. Nothing guards it. `headerIntervalMs` returns `NaN`, `reserveSlot` writes `NaN` into `pacing`, and every subsequent `Math.max(now, NaN)` is `NaN`, so `delay > 0` is false and **no request is ever throttled again on that lane**. Verified.

**The lesson.** `NaN` is the only value in JavaScript that poisons every arithmetic path it touches while comparing false against everything — so a `NaN` bug looks like "the feature just stopped working", with no error. Every `parseInt`/`parseFloat`/`Number()` on external input needs `Number.isFinite` immediately after, no exceptions. This is worth a lint rule.

### S2-3. Rate-limit reset headers are misparsed two ways

`auth/rate-limiter.ts:528-548`.

1. Many APIs send `x-ratelimit-reset` as *delta seconds* (`60` = "60 seconds from now"). The code treats any value under 10^12 as an absolute epoch-seconds timestamp, so `60` becomes **1 January 1970**. `canProceed` then sees `resetAt <= now`, deletes the state, and concludes we're not limited. Verified.
2. The ISO-date fallback branch (line 543) is **unreachable**: `parseInt('2035-01-01T00:00:00Z')` returns `2035`, which passes the `!isNaN` check, and the date is parsed as epoch second 2035 → also 1970. Verified.

**The lesson.** `parseInt` stops at the first non-digit and returns what it found. It is a *prefix* parser, not a validator. Using it as a discriminator ("is this a number or a date?") never works, because it says yes to both. Use `Number()` (which returns `NaN` for `'2035-01-01'`) or an explicit regex. And when you write two branches, write a test that reaches the second one.

### S2-4. Thundering herd after every 429

`auth/rate-limiter.ts:335-362`. The slot-reservation logic that carefully spaces concurrent callers (`reserveSlot`, line 239) is only called on the fast path at line 281. The slow path — the `while (!canProceed())` wait loop — exits and **returns without reserving a slot**. Every caller blocked behind a 429 wakes on the same 1–5s tick and fires simultaneously.

The comment at line 406 shows the author anticipated this and pushed `pacing` forward to compensate — but nothing on the wait path ever reads `pacing`. The mitigation and the bug are twelve lines apart.

**The lesson.** When a function has a fast path and a slow path, list the invariants the fast path establishes and check each one against the slow path. Here the invariant is "every caller that proceeds has claimed a slot", and only one of two exits maintains it. This is the same class of defect as S1-2 — an invariant maintained on some exit paths but not all.

### S2-5. HTTP response bodies are never drained on retry paths

`interpreter/http.ts:212-249`. On 429-retry, 5xx-retry, and 401-refresh, the code `continue`s without reading or cancelling `response.body`. Undici holds the socket until GC. A retry-heavy run leaks connections and can exhaust the agent's pool — which manifests as unexplained timeouts, not as a leak.

**The lesson.** In the `fetch` API, the response body is a resource with an ownership contract, exactly like a file handle. If you're not going to read it, `await response.body?.cancel()`. "I only wanted the status code" is the most common way to leak connections in Node.

### S2-6. A 4xx never reaches the circuit breaker

`interpreter/http.ts:221-234` records failures for `>= 500` and network errors only. A revoked API key producing 100% 403s is invisible to the breaker forever. Compounds S1-2 and the `onError: continue` default.

**The lesson.** "Failure" for a circuit breaker means "this dependency is not working", which is not the same as "the server returned 5xx". A 403 on every request means the dependency is *definitely* not working — arguably more definitively than a 500, which might be one bad shard. Classify by what the status tells you about the dependency's health, not by which range it's in.

### S2-7. OAuth2 refresh doesn't check whether the refresh succeeded

`interpreter/http.ts:534-557`:

```ts
const response = await fetch(this.tokenEndpoint, { ... });
const data = (await response.json()) as { access_token: string; refresh_token?: string };
this.accessToken = data.access_token;
```

No `response.ok` check. A `400 invalid_grant` body has no `access_token`, so `this.accessToken` becomes `undefined` and every subsequent request sends `Authorization: Bearer undefined`. The session is destroyed and the error surfaces as a confusing 401 loop rather than "your refresh token expired".

The `as` cast is what hides this — it asserts a shape the code never verified. There's a `zod` dependency in `package.json` doing nothing here.

**The lesson.** `as` is not a check, it's an instruction to the compiler to stop checking. Every `as` on data crossing a trust boundary — network, disk, user input — is a runtime assumption with no runtime enforcement. Parse, don't cast. You already ship zod.

`expires_in` is also ignored, so tokens are only ever refreshed reactively on a 401 — meaning every token expiry costs a wasted request plus a retry.

### S2-8. The `for` loop's dead-letter queue overwrites its own entries

`interpreter/step-handlers/for-handler.ts:275`: `await store.set(String(index), {...})`.

The key is the loop index. So:
- Two `for` loops in one mission sharing an `onError queue` store overwrite each other
- A second run overwrites the first run's failures
- A resume overwrites what the original run recorded

The dead-letter queue — the thing whose entire job is to not lose failures — loses failures.

**The lesson.** A key must be derived from the *identity of the thing*, never from its position in a collection. Position is a property of one traversal; identity is a property of the record. This is the same reasoning the codebase already applies well elsewhere — `StoreHandler.getRecordKey` throws rather than invent a key (`store-handler.ts:29`), with an excellent comment explaining why. The principle just didn't make it into `for-handler`.

**Fix:** key on `(executionId, action, stepId, recordKey)`.

### S2-9. Checkpoints can move backwards

`interpreter/fetch-handler.ts:199-247`. When `since.updateFrom` extracts a timestamp, it's used verbatim with no comparison to the existing checkpoint. If a page's max `updated_at` is older than the last checkpoint — reordered results, a backdated record, a clock difference between API shards — the watermark rewinds, and the next sync re-fetches a window already processed. With `upsert` that's wasted work; with `set` on a mutable record it can resurrect stale data over newer local state.

**The lesson.** A watermark is monotonic by definition. Enforce that in the one place it's written: `syncedAt = max(previous, candidate)`. Any invariant you rely on but never assert will eventually be violated by real-world data.

### S2-10. A store batch is lost entirely if one record has a bad key

`interpreter/step-handlers/store-handler.ts:78-104`. The bulk path builds the full `records` array before writing, so `getRecordKey` throwing on record 500 of 1,000 discards **all 1,000**. The non-bulk fallback writes records 0–499 and then throws, leaving a partial write.

Same DSL construct, same data, two different atomicity semantics depending on whether the adapter happens to implement `bulkSet`.

**The lesson.** When you add a fast path, its failure semantics must match the slow path's, or the difference must be part of the documented contract. A user cannot reason about `store x -> y` if its behaviour on bad data depends on which adapter is configured. Decide the semantics — all-or-nothing, or skip-and-report — and make both paths implement it.

### S2-11. The webhook server compares its secret with `===`

`webhook/server.ts:438-446`. The control server does this correctly with `timingSafeEqual` and a good comment explaining why (`control/server.ts:242`). The webhook server — the one that by definition must be reachable from the public internet — uses `===`, which short-circuits on the first differing byte and leaks the secret prefix through response timing.

The inconsistency is the story: the same team, the same repo, got it right on the localhost admin server and wrong on the internet-facing one.

**The lesson.** Security primitives belong in one shared helper, used everywhere, never re-derived at the call site. If `safeEqual` had been in `utils/`, this wouldn't have happened. When you write a security-relevant helper, the very next thing to do is grep for other places that should be using it.

### S2-12. Webhook authentication is a static shared secret with no signature

`webhook/server.ts:438-446`. Beyond the timing issue:

- The secret is accepted in a **query parameter** (`?token=...`), where it lands in access logs, proxy logs, and `Referer` headers
- There is no HMAC over the body, so a captured URL is a permanent forgery capability
- Every real webhook provider (Stripe, GitHub, Shopify) signs payloads; none of that is supported

For a framework whose flagship feature is `wait` on a webhook, this is the wrong shape for the problem.

**The lesson.** Authenticating the *channel* and authenticating the *message* are different guarantees. A shared secret proves someone knows the secret. An HMAC over the body proves this specific payload came from the party holding the key and wasn't modified. For webhooks — where the URL leaks easily and the payload triggers business logic — you need the second.

### S2-13. Any HTTP method satisfies a webhook wait

`webhook/server.ts:281-396` doesn't check `req.method`. A `GET` to the registration path counts as a received event and resolves a pending `wait`. Any crawler, link-preview bot, security scanner, or chat client that unfurls the URL advances your business process.

**The lesson.** For any handler, write down the methods it accepts and reject the rest by default. Allowlist, never denylist. `GET` must be safe and idempotent — a `GET` that mutates state violates a contract the whole web assumes, including intermediaries you don't control.

### S2-14. `FileStore` is quadratic and races itself on close 🔖 #234

`stores/file.ts`. The quadratic rewrite is tracked. Two things I didn't see in the issue:

1. `flush()` (line 265) calls `writeToDiskSync()` **without awaiting `this.writeChain`**. An in-flight async write can complete *after* the sync write and rename older data over it. Close-time data loss under exactly the conditions close exists to prevent.
2. In `immediate` mode `dirty` is never set true, so `flush()` is a no-op and `close()` returns while writes are still in flight. `closeStores` awaits a `void`.

**The lesson.** Mixing sync and async I/O against the same file is a race by construction — the sync call jumps the async queue. If you need a synchronous exit path (a legitimate need for `process.on('exit')`), the async path must be quiesced first, and `close()` must be `async` so callers can actually wait for it.

### S2-15. A missing path parameter produces a silently broken URL

`interpreter/evaluator.ts:404-424`. `interpolatePath('/users/{id}', ctx, {userId: 7})` returns `/users/`. Verified.

`DELETE /users/` instead of `DELETE /users/42` is, on a permissive API, a collection delete.

Worse, the resolution loop jumps scope when an intermediate segment isn't an object: with `current = {org: 'acme'}` and a global variable `id`, `{org.id}` resolves to the **global** `id`. Verified. So a typo silently picks up an unrelated value.

**The lesson.** Two lessons. First: an unresolved template placeholder is a bug in the mission, always — there is no case where the author meant "put nothing here". Throw. Second: scope resolution with silent fallbacks between scopes is a whole category of unfindable bugs. Resolution should be one unambiguous rule, and a miss should be an error naming what it looked for and where it looked.

---

## S3 — wrong under unusual conditions, or fragile

**S3-1. `now()` and `anyOf` break replay determinism.** `evaluator.ts:324,352`. See Theme 2. 🔖 #199

**S3-2. `env()` returns `''` for a missing variable.** `evaluator.ts:337`. Verified. A missing credential becomes `Authorization: Bearer ` — a 401 that looks like the API's fault. *Lesson: a config lookup that can't fail can't tell you your config is wrong. Distinguish "set to empty" from "not set".*

**S3-3. Tracing is silently disabled without `persistState`.** `executor.ts:506` requires `this.executionState`, which only exists when `config.persistState` is set. `trace: full` in the DSL does nothing, with no warning. *Lesson: a declared feature that no-ops on a config mismatch must say so at startup.*

**S3-4. Nested step failures are recorded N times.** `executor.ts:1341-1347` pushes to `this.errors` at every frame the exception propagates through. A failure inside a `for` inside an action appears at least twice in `ExecutionResult.errors`. *Lesson: record an error at exactly one layer — the one that decides what to do about it. Everywhere else, rethrow.*

**S3-5. `apply` steps are reported as `fetch`.** `executor.ts:1764` + `observability/events.ts:81`. The `StepType` union has no `'apply'`. Combined with `apply-handler.ts` at **0% test coverage**, this feature is both untested and unobservable. *Lesson: use exhaustive mapped types (`Record<StepType, ...>`) so the compiler catches the missing case.*

**S3-6. `for ... concurrency N` is unbounded.** `for-handler.ts:222`. `run [...]` is capped at `MAX_PARALLEL_ACTIONS = 8` (`executor.ts:250`); the loop's concurrency is whatever the mission says. `concurrency 10000` opens 10,000 concurrent requests. *Lesson: apply resource limits at one layer, consistently. Two fan-out mechanisms with different limits means one of them is wrong.*

**S3-7. Heartbeat and pause-check never fire if every item fails.** `for-handler.ts:210` gates on `processedCount`, which only increments on success. A million consecutively-failing items never checks for a pause request and emits no heartbeat — the run looks hung. *Lesson: liveness signals must be driven by attempts, not successes.*

**S3-8. Store lookup shadows variables in `for ... in`.** `for-handler.ts:145-152` checks `ctx.stores` before variables, so a store named `items` silently wins over a variable named `items`. *Lesson: overlapping namespaces need an explicit precedence rule in the docs and a collision warning at parse time.*

**S3-9. Loop bodies can't accumulate into an outer variable.** `context.ts:83-107`. `setVariable` always writes to the innermost scope, so a `let` inside a `for` creates a fresh binding per iteration and discards it. There is no way to compute a running total. *Lesson: this is a language design gap, not a bug — but it should be documented, and ideally a parse-time error rather than a silent no-op.*

**S3-10. The `where` filter can't reference the loop variable by name.** `for-handler.ts:44` evaluates the filter *before* binding the loop variable, passing the item as `current`. So `where .active` works and `where item.active` silently matches nothing. Both forms parse. *Lesson: when a DSL offers two syntaxes for one concept and one silently fails, that's a design bug. Reject the invalid form at parse time.*

**S3-11. `canProceed` mutates state.** `circuit-breaker.ts:159-194` transitions to half-open and claims the probe slot — a command wearing a query's name, right next to `getStatus` which is genuinely read-only. *Lesson: command–query separation isn't dogma; the practical cost here is that nobody reading the call site knows a state transition happened.*

**S3-12. `evictStale` deletes configuration.** `circuit-breaker.ts:390-405` evicts any closed entry past `maxAgeMs` — including the entry `configure()` created to *hold the config*. Verified: after eviction, a source configured with `failureThreshold: 99` opens at 5. *Lesson: never store configuration and runtime state in the same collection under the same lifecycle. Config is permanent, state is ephemeral.*

**S3-13. Config resolution in `recordFailure` is dead code.** `circuit-breaker.ts:271`: `existing?.config ?? this.getEntry(source)?.config ?? this.defaultConfig`. Since `http.ts` always passes `endpoint` as `undefined`, both lookups are the same key. The lane fallback that `resolveConfig` and `getOrCreateEntry` both perform is missing here, so the first failure on a lane uses default thresholds. *Lesson: three call sites resolving the same config three different ways means it should be one function.*

**S3-14. Per-attempt timeout doesn't cover the response body.** `http.ts:316-343`. The `AbortController` timer is cleared in `finally` when headers arrive; `readCappedText` then reads the body with no deadline. A slow-drip body hangs forever. *Lesson: a timeout should cover the operation the caller cares about, which is "get me the data", not "get me the headers".*

**S3-15. A 429 on a POST without an idempotency key isn't retried.** `http.ts:212` gates retry on `retriable`. But 429 means the request was *rejected*, not committed — it's always safe to retry. Rate-limited writes fail hard. *Lesson: "is it safe to retry" depends on whether the server may have acted, and status codes tell you that. 429 and 503-with-Retry-After are definitively "no action taken".*

**S3-16. `buildUrl` corrupts paths that already carry a query string.** `http.ts:417-428` appends `?${params}` unconditionally, so a path of `/x?a=1` plus a since-param yields `/x?a=1?b=2`. *Lesson: use `URL` and `URLSearchParams` for URL construction; string concatenation of URLs is always eventually wrong.*

**S3-17. `deepMerge` mishandles `__proto__` from API JSON.** `utils/deep-merge.ts`. `JSON.parse` creates `__proto__` as a real own property, `Object.entries` enumerates it, and `out[key] = value` goes through the prototype setter. Verified: the field vanishes from the record and becomes the object's prototype. Not global pollution (the spread creates a fresh object), but silent field loss plus an attacker-influenced prototype. *Lesson: any key-by-key copy from untrusted JSON needs `__proto__`/`constructor`/`prototype` guards, or `Object.create(null)`, or a `Map`.*

**S3-18. `redactSecrets` leaks on the second reference to a shared object.** `utils/redact.ts:31-41`. The cycle guard returns the **unredacted original** on a repeat visit. Verified: `{first: creds, second: creds}` redacts `first` and leaks `second` in clear. It also converts `Date` to `{}`, corrupting every timestamp in traces and logs. *Lesson: a memoisation guard must return the memoised* result*, not the input. And a recursive transform over `Object.entries` silently destroys every class instance it meets.*

**S3-19. `/status` can expose response-body snippets containing secrets.** `http.ts:407-415` puts up to 200 characters of an error response body into the exception message; that lands in `executionState.errors`, which `control/server.ts:265` serves and the execution store writes to disk — neither passing through `redactSecrets`. An API that echoes a token in an error body persists it. *Lesson: redaction has to be applied at the boundary where data leaves the process, not hopefully upstream.*

**S3-20. Control server's documented warning is never emitted.** `control/server.ts:218-234`. The JSDoc says unauthenticated access is allowed "but warn so operators know". No warning exists. *Lesson: a comment describing behaviour that isn't there is worse than no comment — a reader trusts it.*

**S3-21. Webhook oversized-body handling leaks sockets.** `webhook/server.ts:401-427`. On exceeding the cap it rejects and stops accumulating, but never `destroy()`s or drains the request, and the handler returns after writing 413 without resuming the stream. The socket lingers until the server timeout. *Lesson: rejecting a request means closing it, not just ignoring it.*

**S3-22. `receivedEvents++` is a lost-update race.** `webhook/server.ts:362-363` — read-modify-write with an `await` on either side. Two concurrent deliveries can produce one increment against a persistent store, so `expectedEvents: 2` never resolves. *Lesson: counters shared across concurrent handlers need an atomic increment in the store, not read-then-write in the caller.*

**S3-23. `url.parse()` is deprecated with an explicit security caveat.** `webhook/server.ts:9`, `control/server.ts:9`. Node prints `DEP0169` on every test run: *"prone to errors that have security implications. CVEs are not issued for url.parse() vulnerabilities."* You are being warned by the runtime on every CI run. *Lesson: deprecation warnings in test output are signal. Zero-warning output is worth maintaining precisely so that new warnings are visible.*

**S3-24. Store errors report fake source positions.** `store-handler.ts:29` constructs `RuntimeError(..., { line: 1, column: 1 }, ...)`. Every store error in every mission claims line 1, column 1. *Lesson: a wrong answer is worse than no answer. If the position isn't threaded through yet, make the parameter optional and pass `undefined` — then at least the error message can say "position unknown" instead of confidently pointing at the wrong line.*

**S3-25. `first available source` as the default fetch target.** `fetch-handler.ts:276-286` picks whichever source was declared first when a fetch omits its source. In a multi-source mission a forgotten `from X` silently hits the wrong API — with the wrong credentials. *Lesson: defaults are for when there's an obviously correct answer. With two or more candidates there isn't one; that's an error.*

**S3-26. The store source expression is evaluated twice.** `executor.ts:1591` (`storeContentHash`) and `store-handler.ts:64` both call `evaluate(step.source, ctx)`. If the expression contains `now()`, the effect-dedup hash keys on a different value than the one written — so the dedup identity is wrong for exactly the non-deterministic case that most needs it. *Lesson: evaluate once, pass the value. Re-evaluating an expression assumes purity that this language doesn't guarantee.*

**S3-27. `mission.failed` is logged for runs that return `success: true`.** `executor.ts:559` appends the failure event before line 575 filters tolerated errors out. The durable log and the return value disagree. *Lesson: decide the outcome once, then report it everywhere from that one decision.*

**S3-28. `MAX_RESPONSE_BYTES` is a hardcoded 10 MiB with full buffering.** `http.ts:37,379`. Not configurable, and there is no streaming path — a data pipeline can't fetch a 50 MB export at all. *Lesson: for an ETL tool, response size is a domain parameter, not an implementation detail.*

**S3-29. Rate limiter and breaker state are per-process.** No shared backend. Two scheduled missions against the same API in separate processes each think they own the full quota. For a framework that advertises rate-limit discipline, single-process is a significant caveat that should be documented prominently.

**S3-30. `logEvent` is awaited per step start and completion.** `executor.ts:1218,1311`. With a file-backed log that's two durable appends per step, serialised. *Lesson: know your log's batching semantics before you put an `await` on it in the hot path.*

---

## S4 — smells and inconsistencies

- **S4-1.** `SourceManager`/`StoreManager` constructed twice, first pair discarded. `executor.ts:300,309` vs `402,412`.
- **S4-2.** Orphaned JSDoc: the comment at `executor.ts:1574` documents `storeContentHash`; `loadResumingPause` was inserted between them.
- **S4-3.** Dead code: `_fetchStartTime` computed and discarded (`fetch-handler.ts:111`); `pagesFetched` always `undefined` with a comment claiming otherwise (`fetch-handler.ts:137`); `clearPaginationCache()` exported as a documented no-op (`pagination.ts:165`).
- **S4-4.** `ArrayFieldCache` is ~90 lines of TTL, size-cap, and LRU-ish eviction managing **exactly one entry** — the cache key is a per-instance constant. Delete it and use a nullable field.
- **S4-5.** Debug snapshots report `count: -1` as a placeholder for store size (`executor.ts:1819`), as does the trace recorder (`trace/recorder.ts:201`). A sentinel that reaches the UI is a bug the UI has to know about.
- **S4-6.** 432 lint warnings: 241 `consistent-type-assertions`, 178 `no-non-null-assertion`, 13 `no-explicit-any`. Warnings nobody fixes are warnings nobody reads. Either set them to `error` and fix them, or delete the rules.
- **S4-7.** `canProceed` in `AdaptiveRateLimiter` is `async` with no `await` inside, called in a `while` loop — a promise allocation per iteration and a microtask boundary between the capacity check and the slot reservation, which is precisely the interleaving the reservation design exists to prevent.
- **S4-8.** `laneBackoff` and `pacing` maps are never swept, unlike `state` which has a full eviction path.
- **S4-9.** `MAX_PARALLEL_ACTIONS = 8` (`executor.ts:250`) is a module constant while every comparable limit is configurable.
- **S4-10.** `storeOne` computes the record key twice (`store-handler.ts:107,127`), so a key expression using `now()` emits a different key in the observability event than the one it stored under.
- **S4-11.** `sql()` and `nosql()` stores throw as unimplemented (`stores/factory.ts:82,99`) 🔖 #100/#101, yet shipped examples use them (`examples/incremental-sync/sync.vague:26`). Related to 🔖 #222 (most examples don't parse).
- **S4-12.** `SENSITIVE_KEY` matches `session`, so an innocuous `session_count` is redacted; it misses `pin`, `otp`, `signature`, and `jwt`.

---

# Part 3 — edge cases nobody has spotted

The brief asked specifically for this. These aren't restatements of the findings above — they're inputs I'd expect a fuzzer or a bad afternoon in production to find, ordered by how likely they are to actually happen.

**1. An API that returns the same cursor twice.** Handled (`fetch-handler.ts:431`) — good. But an API that *alternates* between two cursors (A → B → A → B) loops to the page cap, duplicating every record. The equality check only catches a self-loop of length one.

**2. A numeric cursor of `0`.** `pagination.ts:264`: `cursorValue ? String(cursorValue) : undefined`. A cursor of `0` — legitimate for offset-style tokens — is falsy, so pagination stops at page one.

**3. A middle page that returns fewer items than `pageSize`.** `hasMore: items.length >= pageSize` (`pagination.ts:136`). Any API that filters *after* paginating (permissions, soft deletes, tenant scoping) routinely returns short middle pages. Pagination stops early and silently.

**4. Two records in a page with the same key.** `bulkSet` builds an array with duplicates; adapters that `Map`-ify it keep the last, adapters that iterate write both. Undefined behaviour, no warning.

**5. A response body that is a JSON array at the top level, with `updateFrom` set.** `extractNestedValue(data, 'updated_at')` on an array returns `undefined`, so the checkpoint silently falls back to wall-clock time rather than the data's own clock — the exact scenario `updateFrom` exists to handle.

**6. A response of `null` or a bare string to a `store` step.** `store-handler.ts:69` casts to `Record<string, unknown>` and calls `getRecordKey`, which does `record.id` on `null` → an unhandled `TypeError` instead of the careful `RuntimeError` the same function raises for a missing key.

**7. `Retry-After` as an HTTP-date in the past.** `parseRetryAfterMs` clamps to `0` correctly (`http.ts:33`) — good. But `parseRateLimitHeaders` has a second, independent `Retry-After` parser (`rate-limiter.ts:551`) with no clamp, so a past date yields a negative `retryAfter` and `state.retryAfter` lands in the past. Two parsers for one header, different semantics.

**8. A `for` loop over an array of arrays.** `getCollection` requires the collection to be an array but doesn't constrain the items. Nested arrays flow into `store` as records and `String(index)` keys.

**9. `concurrency` set to `0` or a negative number.** `Math.min(concurrency, items.length)` → `Array.from({length: 0})` → zero workers → `Promise.all([])` resolves immediately. **The loop body never executes and the step reports success.** `createPaginationStrategy` validates `pageSize` with exactly this reasoning (`pagination.ts:286`); `concurrency` got no such check.

**10. A store name that collides with a variable name in `for ... in`.** S3-8. Silent, and the failure mode is "the loop iterates the wrong data", not an error.

**11. A mission where `resumeFrom` points at a fully-completed execution.** `findResumePoint` returns `stages.length`; `mission.pipeline.stages[resumeIndex]` is `undefined`; `getStageName(undefined)` calls `isParallelStage(undefined)` (`executor.ts:773-775`). Worth checking whether that throws — it's on the resume path, which is where you least want a crash.

**12. A `jump` target that appears only inside a parallel stage.** `executor.ts:816` searches with `!isParallelStage(s) && s.action === error.action`, so jumping to an action that exists but only within `run [A, B]` throws "Jump target action not found" — technically correct, needlessly confusing.

**13. A `queue` directive with no target and no store.** `handleQueue` logs "value discarded" and returns (`executor.ts:1171`). The item is dropped. That should be a parse-time error.

**14. Webhook `expiresAt` already past when `waitForEvents` is called.** `waitTimeout` goes negative (`webhook/server.ts:204`) and the long-timeout fires immediately — probably fine, definitely untested.

**15. A registration that expires between the 410 check and the event write.** The 410 path deletes the registration but never its events (`webhook/server.ts:304`), leaking orphaned events in the store.

**16. Duplicate query parameters on a webhook URL.** `url.query as Record<string, string>` (`webhook/server.ts:357`) — `?a=1&a=2` produces `string[]`, and the cast lies about it. Anything downstream doing `.trim()` on it throws.

**17. A `map` producing a field named `__proto__`.** Flows into `deepMerge` on upsert. See S3-17.

**18. Clock skew between the machine and the API.** Checkpoints are stamped with local wall-clock time (`fetch-handler.ts:210`). A host running two minutes fast silently skips two minutes of records on every incremental sync. There's no NTP assumption documented and no drift detection — and this failure is invisible, permanent, and looks like an API problem.

**19. Two mission processes writing the same `FileStore` path.** No file locking. The atomic rename means you get one process's whole map, not a corrupt file — so the loser's writes vanish silently. With a scheduler that can overlap runs (`scheduler/`), this is reachable in normal operation.

**20. A response body of exactly `MAX_RESPONSE_BYTES`.** `if (size > MAX_RESPONSE_BYTES)` is exclusive, so exactly-at-the-limit passes. Fine — but no test covers the boundary, and the same limit is asserted nowhere.

---

# Part 4 — testing

**The numbers:** 1,434 passing, 26 skipped, 71.29% statement coverage, 69.94% branch.

That's a real investment and it shows — the parser and lexer coverage is strong, the crash-injection suite in `durability/` is a genuinely good idea, and `stores/file-concurrent-write.test.ts` tests a race, which most teams never do.

**But the coverage is inverted.** The best-tested code is the least dangerous, and the worst-tested code is where the money is:

| Area | Statement coverage | Why it matters |
|---|---|---|
| `mcp/server.ts` | **0%** | 622 lines, a shipped binary (`reqon-mcp`) |
| `step-handlers/apply-handler.ts` | **0%** | A DSL feature users can write today |
| `trace/recorder.ts` | **2.1%** | The time-travel debugging headline feature |
| `execution-log/postgres-store.ts` | **3.7%** | The production durable-log backend |
| `debug/cli-debugger.ts` | 9.4% | |
| `utils/type-guards.ts` | 5.3% | Used throughout the evaluator |

`postgres-store.ts` is gated behind `npm run test:pg`, which is a reasonable choice — but it means the transactional backend that the durability story depends on is not covered by CI. That should run against a container in CI, not be opt-in.

**The deeper problem: the tests assert the happy path returns the right value, and almost never assert that the sad path is visible.** Every one of the fifteen defects I reproduced in Appendix A is in a file with existing tests. `pagination.test.ts` exists and passes; nothing asserts that truncation is reported. `circuit-breaker.test.ts` exists and passes; nothing drives a probe to a 4xx.

**What I'd add, in order:**

1. **Failure-visibility tests.** For each safety limit (page cap, item cap, body size, `maxWait`, breaker threshold), a test that trips it and asserts the caller can *detect* that it tripped. Not that it logged — that it's in the return value or an event.
2. **A "hostile API" fixture suite.** One mock server that returns: garbage rate-limit headers, cursors that alternate, short middle pages, `{errors: [], data: [...]}`, 403 on everything, bodies that never finish. Run every example mission against it and assert nothing reports `success: true` with zero records.
3. **Property tests for the evaluator.** `105` is already open for the parser; the evaluator needs it more. Trichotomy (`a < b`, `a == b`, `a > b` — exactly one true) would have caught S1-3 immediately.
4. **Determinism tests.** Run a mission twice with the same log and assert identical effect IDs. That's the test that makes the durability claim real, and it will fail today because of `now()`.

**The lesson for the team.** Coverage measures which lines ran, not which behaviours are guaranteed. A line covered by a test that asserts the happy path is not tested — it's *visited*. When you write a test, ask what would have to break for it to fail. If the answer is "the feature would have to stop existing entirely", it's a smoke test, and you need a second one that pins the actual contract.

---

# Part 5 — what is genuinely good

I've been hard on this, and the brief asked me to be. It would be dishonest not to say what's working, because the good parts are the parts to build on.

**The comments are the best thing here.** Not "increment the counter" — comments that explain *why a design is the way it is*, including the alternative that was rejected and why. Examples worth copying:

- `rate-limiter.ts:230-238` on why slot reservation beats measuring elapsed time for concurrent callers
- `http.ts:113-116` on why only idempotent verbs auto-retry
- `stores/file.ts:147-158` on why concurrent writes must be chained
- `executor.ts:1530-1537` on why store-effect identity had to become content-aware after a bug where every backfill page but the first was skipped

That last one is a comment written by someone who debugged a nasty problem and left a note so the next person doesn't reintroduce it. That's the single highest-leverage thing you can do for a codebase. **Juniors: this is the standard. Write down the alternative you rejected.**

**Other things done right:**

- `safeJoin`/`sanitizeSegment` (`utils/path.ts`) — proper path-traversal defence, correctly implemented, applied at the store boundary
- `writeFileAtomic` — temp file, fsync, rename. Missing the directory fsync, but the shape is right and most people don't get this far
- `OAuth2AuthProvider`'s single-flight refresh guard (`http.ts:496`) — a real bug class (rotating refresh tokens killed by concurrent refreshes) anticipated and prevented
- `getRecordKey` throwing rather than inventing a key (`store-handler.ts:22-36`), with a comment explaining both failure modes it prevents
- The control server *refusing* to bind non-loopback without a token, rather than warning
- `settleWithLimit` (`executor.ts:944`) — a correct bounded-concurrency implementation that preserves result order, which people get wrong constantly
- `parseRetryAfterMs` handling both delta-seconds and HTTP-date, clamping, and explaining that the clamp exists to stop `sleep(NaN)` spinning
- Crash-injection tests in `durability/` — genuinely ambitious

The instincts are right. The gap is consistency: the same care applied to `parseRetryAfterMs` was not applied to the second `Retry-After` parser twelve files away, and the `timingSafeEqual` in the control server didn't make it to the webhook server.

---

# Part 6 — what I'd do, in order

**This week — the S1s.** Each is small.

1. Add `truncated` to `FetchResult`; block checkpoint advance when set; make the caps configurable. *(S1-1, half a day)*
2. Release `probeInFlight` on every `recordFailure` exit; report 4xx to the breaker. *(S1-2, half a day)*
3. Type-aware comparison in the evaluator: strings lexicographically, ISO-8601 as dates, `false` only for genuinely absent operands. *(S1-3, one day with tests)*
4. Share one auth-type union between parser and runtime; exhaustive switch; throw on unimplemented at startup. *(S1-4, half a day)* 🔖 #200

**Next — stop the bleeding on silence.** One PR that converts every "log a warning and return something plausible" into a typed failure. Grep for `log(` followed by `return`. That's Theme 1, and it's most of S2.

**Then — a hostile-API test fixture.** One mock server, all the nasty behaviours, every example mission run against it. This is the highest-leverage test work available and it will find things this review didn't.

**Then — the durability honesty pass.** Either make `now()`/`anyOf` log-backed, or document loudly that replay is not deterministic when a mission uses them. 🔖 #199 is open; the fix belongs with it. Add the directory fsync.

**Then — split `executor.ts`.** Not for aesthetics. Split it so that adding a step type is one edit in one place and the compiler enforces the rest. That single change prevents S3-5 and its whole family.

**Ongoing — turn the lint warnings to errors.** 432 warnings means the signal is gone. Fix or delete the rules; don't leave them at `warn`.

---

# Appendix A — reproductions

Fifteen tests, all passing against `139080f`, each asserting the **current, broken** behaviour. Drop into `src/review-verify.test.ts` and run `npx vitest run src/review-verify.test.ts`.

They're written to assert the bug so you can watch them fail as you fix it — invert each assertion when you land the fix, and it becomes the regression test.

```ts
import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from './auth/circuit-breaker.js';
import { AdaptiveRateLimiter, parseRateLimitHeaders } from './auth/rate-limiter.js';
import { evaluate, interpolatePath } from './interpreter/evaluator.js';
import { createContext, setVariable } from './interpreter/context.js';
import { deepMerge } from './utils/deep-merge.js';
import { redactSecrets } from './utils/redact.js';
import { FetchHandler } from './interpreter/fetch-handler.js';
import type { HttpClient } from './interpreter/http.js';
import type { FetchStep } from './ast/nodes.js';
import type { SyncStore } from './sync/index.js';

// ---------- S1-2: circuit breaker wedges permanently ----------
describe('S1-2 circuit breaker', () => {
  it('never releases the probe slot when a probe fails with an uncounted status', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1 });
    cb.configure('api', { failureThreshold: 1, resetTimeout: 1 });

    cb.recordFailure('api', undefined, 500);
    expect(cb.getStatus('api').state).toBe('open');

    await new Promise((r) => setTimeout(r, 5));
    expect(cb.canProceed('api')).toBe(true);          // takes the probe slot
    expect(cb.getStatus('api').state).toBe('half_open');

    cb.recordFailure('api', undefined, 403);          // uncounted -> early return

    expect(cb.getStatus('api').state).toBe('half_open');
    expect(cb.canProceed('api')).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(cb.canProceed('api')).toBe(false);         // still wedged
  });

  it('evictStale silently discards a source configuration (S3-12)', () => {
    const cb = new CircuitBreaker();
    cb.configure('api', { failureThreshold: 99, failureWindow: 10 });
    cb.evictStale(-1);
    for (let i = 0; i < 5; i++) cb.recordFailure('api@proxy-a', undefined, 500);
    expect(cb.getStatus('api@proxy-a').state).toBe('open'); // opened at 5, not 99
  });
});

// ---------- S2-2 / S2-3: rate-limit header parsing ----------
describe('S2-2/S2-3 rate limiter', () => {
  it('poisons the pacing schedule with NaN', () => {
    const rl = new AdaptiveRateLimiter();
    rl.configure('api', { strategy: 'throttle', fallbackRpm: 60 });
    rl.recordResponse('api', {});
    expect(rl.getThrottleDelay('api')).toBeGreaterThanOrEqual(0);

    const info = parseRateLimitHeaders({
      'x-ratelimit-remaining': 'unknown',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
    });
    expect(Number.isNaN(info.remaining as number)).toBe(true);

    rl.recordResponse('api', info);
    expect(Number.isNaN(rl.getThrottleDelay('api'))).toBe(true); // throttle is dead
  });

  it('misparses a delta-seconds reset header as 1970', () => {
    expect(parseRateLimitHeaders({ 'x-ratelimit-reset': '60' }).resetAt!.getFullYear()).toBe(1970);
  });

  it('never reaches the ISO-date branch for a reset header', () => {
    const info = parseRateLimitHeaders({ 'x-ratelimit-reset': '2035-01-01T00:00:00Z' });
    expect(info.resetAt!.getFullYear()).toBe(1970);
  });
});

// ---------- S1-3: comparison operators ----------
describe('S1-3 comparisons', () => {
  const cmp = (l: unknown, r: unknown, op: string) =>
    evaluate({ type: 'BinaryExpression', operator: op,
      left: { type: 'Literal', value: l }, right: { type: 'Literal', value: r } } as never,
      createContext());

  it('silently returns false for ISO date comparison', () => {
    expect(cmp('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z', '>')).toBe(false);
    expect(cmp('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '>')).toBe(false);
  });

  it('breaks trichotomy', () => {
    expect(cmp('banana', 'apple', '<')).toBe(false);
    expect(cmp('banana', 'apple', '>=')).toBe(false);
  });
});

// ---------- S2-15: path interpolation ----------
describe('S2-15 path interpolation', () => {
  it('interpolates an absent value to an empty segment', () => {
    expect(interpolatePath('/users/{id}', createContext(), { userId: 7 })).toBe('/users/');
  });

  it('falls back to an unrelated global when a segment is not an object', () => {
    const ctx = createContext();
    setVariable(ctx, 'id', 'GLOBAL-LEAK');
    expect(interpolatePath('/orgs/{org.id}', ctx, { org: 'acme' })).toBe('/orgs/GLOBAL-LEAK');
  });
});

// ---------- S3-2: env() ----------
describe('S3-2 env()', () => {
  it('returns empty rather than failing fast', () => {
    delete process.env.REVIEW_DEFINITELY_UNSET;
    expect(evaluate({ type: 'CallExpression', callee: 'env',
      arguments: [{ type: 'Literal', value: 'REVIEW_DEFINITELY_UNSET' }] } as never,
      createContext())).toBe('');
  });
});

// ---------- S3-17 / S3-18: deepMerge and redaction ----------
describe('S3-17/S3-18 data handling', () => {
  it('deepMerge assigns through the prototype setter and loses the field', () => {
    const fromApi = JSON.parse('{"__proto__": {"polluted": true}, "id": 1}');
    const merged = deepMerge({ id: 1 }, fromApi);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
    expect((merged as { polluted?: boolean }).polluted).toBe(true);
  });

  it('redactSecrets leaks the second reference to a shared object', () => {
    const creds = { api_key: 'sk-live-SECRET' };
    const out = redactSecrets({ first: creds, second: creds });
    expect(out.first.api_key).toBe('[REDACTED]');
    expect(out.second.api_key).toBe('sk-live-SECRET'); // leaked
  });

  it('redactSecrets destroys Date values', () => {
    expect((redactSecrets({ when: new Date('2026-01-01') }) as { when: unknown }).when).toEqual({});
  });
});

// ---------- S1-1 / S2-1: pagination ----------
function endlessClient(itemsPerPage: number): HttpClient {
  let page = 0;
  return { request: async () => ({ status: 200, headers: {}, data: {
      items: Array.from({ length: itemsPerPage }, (_, i) => ({ id: `p${++page}-i${i}` })) } }),
  } as unknown as HttpClient;
}

describe('S1-1 pagination truncation advances the checkpoint anyway', () => {
  it('stops at the 100-page cap with no signal, then moves the watermark', async () => {
    const ctx = createContext();
    ctx.sources.set('api', endlessClient(10));

    const recorded: Array<{ key: string; syncedAt: Date }> = [];
    const syncStore = {
      getLastSync: async () => new Date('2020-01-01T00:00:00Z'),
      recordSync: async (e: { key: string; syncedAt: Date }) => { recorded.push(e); },
    } as unknown as SyncStore;

    const log = vi.fn();
    const handler = new FetchHandler({ ctx, oasSources: new Map(),
      sourceConfigs: new Map(), syncStore, missionName: 'm', log });

    const step = { type: 'FetchStep', source: 'api', method: 'GET',
      path: { type: 'Literal', dataType: 'string', value: '/things' },
      paginate: { type: 'page', param: 'page', pageSize: 10 },
      since: { type: 'lastSync', param: 'since', format: 'iso' } } as unknown as FetchStep;

    const result = await handler.execute(step);

    expect((result.data as unknown[]).length).toBe(1000);      // server had more
    expect(log.mock.calls.flat().some((m) => String(m).includes('pagination limit'))).toBe(true);
    expect(Object.keys(result)).not.toContain('truncated');    // caller cannot tell

    const before = new Date();
    await handler.recordCheckpoint(result.checkpointKey!, step, result.data, before);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].syncedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('S2-1 pagination guesses the items array', () => {
  it('picks an unrelated empty array and ends pagination after one page', async () => {
    const ctx = createContext();
    ctx.sources.set('api', { request: async () => ({ status: 200, headers: {},
      data: { warnings: [], data: Array.from({ length: 10 }, (_, i) => ({ id: i })) } }),
    } as unknown as HttpClient);

    const handler = new FetchHandler({ ctx, oasSources: new Map(),
      sourceConfigs: new Map(), log: () => {} });

    const result = await handler.execute({ type: 'FetchStep', source: 'api', method: 'GET',
      path: { type: 'Literal', dataType: 'string', value: '/things' },
      paginate: { type: 'page', param: 'page', pageSize: 10 } } as unknown as FetchStep);

    expect(result.data).toEqual([]);   // real page silently discarded
  });
});
```

---

# Appendix B — the principles, extracted

For the juniors on the team. These are the rules the findings above are instances of. Each one is a question to ask while writing code, not after.

**On failure.**
1. Three honest options: succeed, fail loudly, or return a value the caller is *forced* to handle. "Log and continue" is none of them.
2. If a log line says "warning", ask why it isn't a thrown error or a field on the return type.
3. When you write a safety limit, ask what the caller does differently when it fires. If they can't tell, it's a data-loss mechanism.
4. Auth never fails open. Configured-but-unimplemented is a startup error.

**On correctness.**
5. Any invariant you rely on but never assert will eventually be violated by real data. Watermarks are monotonic — enforce it where it's written.
6. A key comes from the identity of the thing, never its position in a collection.
7. Every `parseInt`/`Number()` on external input needs `Number.isFinite` on the next line. `NaN` fails silently and poisons everything downstream.
8. `parseInt` is a prefix parser, not a validator. It says yes to `'2035-01-01'`.
9. `as` is not a check. Parse data crossing a trust boundary; don't cast it.
10. Write down the types your domain actually carries before you decide what to coerce to.

**On design.**
11. Split by axis of change, not line count. If changing the retry policy *and* the trace format *and* the step list all touch one file, it's three files.
12. Make illegal states unrepresentable. Two independently-maintained string unions for the same concept will diverge; one shared union with an exhaustive switch can't.
13. A heuristic runs in production forever. Add the config escape hatch and make the guess observable.
14. When you already have structured data, never re-derive it from a string rendering of itself.
15. State machines holding a resource need release on *every* exit path — including the early return you add next year. Better: make the resource self-healing (a timestamp, not a boolean).
16. Fast path and slow path must establish the same invariants. List them and check both.
17. Config and runtime state don't share a collection — they have different lifecycles.
18. Security primitives live in one shared helper. When you write one, grep for the other places that need it.

**On tests.**
19. Coverage measures which lines ran, not which behaviours are guaranteed.
20. When you write a test, ask what would have to break for it to fail. If the answer is "the feature would have to vanish", write a second one.
21. Test the requirement, not the implementation. "The breaker opens after five 500s" tests the state machine. "A 403ing API doesn't get a million requests" tests the point.
22. For every safety limit, write a test that trips it and asserts the caller can *detect* it tripped.

**On comments.**
23. Write down the alternative you rejected and why. This codebase does it better than most — keep doing it.
24. A comment describing behaviour that isn't there is worse than no comment. Someone will trust it.

---

*Findings marked 🔖 are already tracked: #100, #101, #199, #200, #222, #234.*
