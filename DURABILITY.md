# Durability guarantees

Reqon can run a mission as a **durable execution**: an append-only event log
records every step and side effect as it happens, so a run that is interrupted —
process crash, deploy, `kill -9` — can be resumed and finished exactly where it
left off, without losing work or repeating effects.

These guarantees are **explicit and tested**. Every claim below maps to a test
that proves it; the crash-injection suite is a dedicated CI gate.

## How to enable it

Durable execution is opt-in. Pass an `ExecutionLogStore` as `executionLog`:

```ts
import { execute, SqliteExecutionLog } from 'reqon-dsl';

await execute(source, {
  executionLog: new SqliteExecutionLog('.reqon-data/execution-log.sqlite'),
});
```

With no `executionLog` configured, behaviour is unchanged and these durability
semantics do not apply (there is nothing to replay from).

To resume an interrupted run, re-run with the same log and the prior execution
id:

```ts
await execute(source, { executionLog, resumeFrom: priorExecutionId });
```

## The guarantees

### Delivery — at-least-once

A fetch may be issued more than once across a crash/resume boundary (the request
can complete on the server just as the process dies, before the log records it).
Reqon never silently drops a step, so delivery is **at-least-once**, never
at-most-once.

### Effects — exactly-once where the API cooperates, else at-least-once + dedup

A side effect has a stable identity:
`effectId(executionId, stepId, attempt, effectType, discriminator)`. When an
effect is applied, an `effect.applied` event is recorded; on replay an effect
already recorded as applied is **skipped**. That gives exactly-once application
*on replay*.

For the effect to be exactly-once *end-to-end* (including the case where the
process dies between performing the effect and recording it), the downstream
must cooperate:

- **Mutating fetches** (`post`/`put`/`patch`/`delete`) carry a stable
  `Idempotency-Key` header in durable mode — a hash of
  `(executionId, stepId, method, path, body)`, so it is identical across a retry
  or replay of the same request yet distinct per loop iteration. Where the API
  honours idempotency keys, the re-issued request is de-duplicated server-side:
  **exactly-once**. Where it does not, you get **at-least-once**. `GET` requests
  are safe and carry no key.
- **Store writes** are keyed (`store … { key: .id }`), so re-applying the same
  record is an upsert, not a duplicate: **at-least-once + dedup → effectively
  once** in the store.

### Resume across restart — replay + fold

Resume is "replay the log and fold to last state". Folding reconstructs the run
status, which steps completed, which effects were applied, the latest sync
checkpoint per key, and any pending pause. A resumed run re-executes from the
start of the mission but **skips effects already recorded as applied**, so
non-effect steps (map/validate) simply re-run idempotently while store writes and
mutating fetches are not repeated.

### Crash safety — proven, not asserted

The crash-injection suite runs a mission whose every step persists an effect,
then models a crash at **every event boundary** (persist the log up to that
boundary, then abort — the exact on-disk state a `kill -9` leaves) plus a torn
mid-write. After each, it resumes from the persisted log + store with fresh
instances and asserts the final state is **identical to an uninterrupted run**:
no lost record, no duplicated effect.

## Storage backends

The event log is pluggable (`ExecutionLogStore`). Choose by durability need:

| Backend                | Durability | Use for | Notes |
| ---------------------- | ---------- | ------- | ----- |
| `MemoryExecutionLog`   | None (process memory) | tests, ephemeral runs | lost on exit |
| `FileExecutionLog`     | Survives restart | local / dev | append-only JSON-lines; tolerates a torn final line and heals an unterminated tail on the next append. No atomic locking — single-process only. |
| `SqliteExecutionLog`   | Transactional, fsync-backed | single-process self-hosting | WAL + `synchronous = NORMAL`; `seq` assigned atomically inside the INSERT under a `(execution_id, seq)` primary key. Requires the optional peer dependency `better-sqlite3`. |
| `PostgresExecutionLog` | Transactional, multi-node | multi-node / production | `seq` assigned inside the INSERT under a `(execution_id, seq)` primary key; concurrent appenders that collide retry on unique-violation, so they always land on distinct, contiguous seqs. Requires the optional peer dependency `pg`. |

## Derived views — one log, not four stores

In durable mode the log is the single source of truth; the subsystems that used
to keep their own state are now **views folded back from the log**:

- **Sync** — incremental-sync checkpoints are `checkpoint.advanced` events;
  `lastSync` resolves from the log (`LogBackedSyncStore`), monotonic per key, so
  a sync's progress survives a crash and resumes atomically with the run.
- **Pause** — a `pause.created` event carries the full pause payload (deadline,
  resume triggers, captured checkpoint) and `pause.resumed` records how it ended,
  so a paused run is reconstructable from the log alone (`LogBackedPauseStore`).
- **Trace** — the ordered events *are* the time-travel trace; `LogTraceView`
  derives a navigable timeline and audit summary with no separate trace store.

Because the log can now hold resume state (a pause checkpoint's captured
variables), `FileExecutionLog` creates its files owner-only (`0o600`).

## Durable connectors — resumable backfill

A paginated fetch marked `backfill: true` becomes a **resumable, memory-bounded
backfill** built on the log. After each page is fetched and stored, the run
appends a `page.completed` event recording the next page/cursor. Two properties
fall out:

- **Survives a restart/deploy.** A resume reads the last `page.completed` and
  continues from that page — it never re-fetches from the start.
- **Flat memory.** `backfillMaxItemsPerRun` caps how much one run accumulates;
  hitting it stops the run *cleanly* (marked not-`done`), and the next resume
  continues. An arbitrarily large historical sync therefore completes across
  many bounded runs. Once the API signals the end, the final page is marked
  `done` and further resumes fetch nothing.

```vague
get "/items" {
  paginate: offset(offset, 200),
  backfill: true
}
store response -> warehouse { key: .id }
```

```ts
// Pause/redeploy/resume a large backfill — same log + execution id continues it.
await execute(src, { executionLog, backfillMaxItemsPerRun: 10_000 });
await execute(src, { executionLog, resumeFrom: priorExecutionId });
```

## Pauses and timers

A `pause` suspends a run without holding resources. In durable mode the lifecycle
is recorded in the log (`pause.created`, `pause.resumed`), so the folded state
knows a run is paused and on what.

**The triggers fire only while something is listening.** The executor records
the `resumeOn:` triggers and stops; it does not run a timer loop itself. To let
the triggers fire, run under `executeWithResume(source, { executionLog,
webhookServer })`: it starts a `PauseOrchestrator` over the same log, which
routes an inbound webhook on the pause's path into a resume, polls for expired
timeouts, and re-invokes `execute({ resumeFrom })` so the replay records
`pause.resumed` and continues past the pause. It loops until the run finishes,
so a mission with several pauses completes in one call. Custom hosts can build
the same wiring with `PauseOrchestrator` directly.

Without an orchestrator (a plain CLI run), a paused run continues when it is
re-run with the same log and execution id (`--resume <id>` /
`execute(…, { resumeFrom })`).

Resume is **single-shot**: a timeout poll and an inbound webhook racing to
resume the same pause fire the resume exactly once, and the orchestrator
re-registers a lost webhook registration on start so a restart does not strand
a waiting pause.

## Guarantee → proving test

| Guarantee | Test |
| --------- | ---- |
| Event log records mission/step/effect in order | `packages/reqon-dsl/src/interpreter/executor-eventlog.test.ts` → "executor emits an execution event log" |
| Resume skips an already-applied store effect | `packages/reqon-dsl/src/interpreter/executor-eventlog.test.ts` → "resume from the execution log skips applied effects" |
| Mutating fetch carries a stable `Idempotency-Key`; GET does not; off when not durable | `packages/reqon-dsl/src/interpreter/fetch-handler.test.ts` → "idempotency keys"; `packages/reqon-dsl/src/interpreter/pipeline.test.ts` → "sends an Idempotency-Key …" |
| Checkpoint advance and pause lifecycle are logged | `packages/reqon-dsl/src/interpreter/executor-durable-events.test.ts` |
| **Crash at every boundary → no lost record, no duplicated effect** | `packages/reqon-dsl/src/durability/crash-injection.test.ts` → "survives a crash at EVERY boundary" |
| Torn mid-write line is ignored and resume stays coherent | `packages/reqon-dsl/src/durability/crash-injection.test.ts` → "ignores a torn final log line …" |
| File log survives restart / tolerates a torn final line | `packages/reqon-dsl/src/execution-log/file-store.test.ts` |
| SQLite log is durable across reopen and continues `seq` | `packages/reqon-dsl/src/execution-log/sqlite-store.test.ts` |
| Postgres log is durable across reconnect; concurrent appenders get distinct, contiguous `seq`s | `packages/reqon-dsl/src/execution-log/postgres-store.test.ts` (CI, against a Postgres service) |
| Pause resume is single-shot under a timeout/webhook race | `packages/reqon-dsl/src/pause/pause.test.ts` → "resume is single-shot under races"; `packages/reqon-dsl/src/pause/orchestrator.test.ts` → "resumes exactly once when a webhook and an expired timeout race" |
| A webhook over real HTTP, or an expired timeout, resumes a paused mission end to end; the tail runs exactly once | `packages/reqon-dsl/src/interpreter/executor-pause-resume-e2e.test.ts` |
| Orchestrator restart re-registers a lost webhook registration | `packages/reqon-dsl/src/pause/orchestrator.test.ts` → "re-registers a lost webhook registration on start (restart recovery)" |

Run the durability proof on its own:

```bash
npm run test:crash
```

## Known limits

- **Multi-node**: use `PostgresExecutionLog` — concurrent appenders are
  serialised on a `(execution_id, seq)` primary key with unique-violation retry.
  `SqliteExecutionLog` is single-process; `FileExecutionLog` is dev-only.
- **`FileExecutionLog` is dev-grade**: no atomic sequence assignment or locking;
  do not point two processes at the same file log. Use `SqliteExecutionLog` for
  real durability.
- **Exactly-once needs API cooperation**: without server-side idempotency-key
  honouring, mutating fetches are at-least-once. Design downstream effects to be
  idempotent (keyed writes, idempotency keys) where correctness depends on it.
- **Pause-across-restart**: the pause lifecycle is recorded in the log and the
  orchestrator recovers a lost webhook registration on start, but resumption of
  a long timer across a process restart is not yet covered by the
  crash-injection suite.
- **Pause triggers need a live host**: `resumeOn: timeout | webhook` fires only
  while `executeWithResume` (or a `PauseOrchestrator`) is running. A plain CLI
  run exits on pause, and something outside the process has to re-invoke the
  mission with `--resume` / `resumeFrom`.
