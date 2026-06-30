# Durable long wait — pause, restart, resume

The flagship for resource-free long waits (#143): a mission that **pauses for a
webhook, survives a process restart, and resumes exactly where it left off** —
holding zero compute while it waits.

This is the visible magic Temporal runs a cluster for. In Reqon it is a
declarative `pause`:

```vague
action AwaitApproval {
  pause {
    duration: "30d",
    resumeOn: webhook "/approved"
  }

  let record = { id: "req-1", status: "approved" }
  store record -> approvals { key: .id }
}
```

## How it works

With a durable execution log configured, the whole pause lives in the log:

1. **Suspend.** Hitting `pause` appends a `pause.created` event carrying the full
   pause state — deadline, resume triggers, and the captured checkpoint — then
   stops. No timer thread, no held connection, no process needs to stay alive.
2. **Restart.** The waiting pause is reconstructable from the log alone
   (`LogBackedPauseStore`), so a brand-new process — after a deploy, a crash, or
   days later — can see it and its deadline.
3. **Resume.** Re-running with the same execution id replays the log, records
   `pause.resumed`, and continues **past** the pause (restoring the checkpoint
   and any webhook payload) to completion. The steps after the pause run on
   whichever process is alive when the webhook arrives.

The timeout-vs-webhook resume is single-shot: whichever fires first wins, exactly
once.

## Run the demo

```bash
npx tsx examples/durable-approval/demo.ts
```

It runs the mission against a **file-backed** execution log, then resumes it with
a separate executor that shares nothing in memory — a faithful stand-in for a
real restart between the pause and the webhook.

```
▶  Starting approval mission…
⏸  Paused (execution …). Holding zero compute.
   Durable log shows 1 pause waiting on: 2026-07-30T…
💥  …simulating a full process restart / redeploy…
▶  Webhook received — resuming on a brand-new process…
✅  Resumed and completed (execution …).
   Pauses still active: 0
```

## See also

- [`DURABILITY.md`](../../DURABILITY.md) — the guarantees and how the log backs them.
- [`temporal-comparison`](../temporal-comparison) — the same durability, contrasted with a Temporal workflow.
