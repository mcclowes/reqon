# Sharded bulk fetch (FPL)

Pulling per-manager data from the Fantasy Premier League API: a public,
unauthenticated API with no rate limit headers and a low tolerance for hammering
from one IP.

Two files, and the order matters.

## Start with bootstrap.vague

`bootstrap-static/` returns every player, team, and gameweek in the game in one
request. If that's the data you want, you're done. No proxies, no fleet, no
sharding.

```bash
reqon examples/fpl-sharded/bootstrap.vague --verbose
```

Reach for the second file only when you need the per-manager endpoints
(`/entry/{id}/history/`, `/entry/{id}/event/{gw}/picks/`), where the work is
millions of small requests rather than one big one.

## managers.vague

Shows the three pieces that make a sharded fan-out work.

**Egress pool.** `proxy: [...]` on the source rotates requests round-robin
across proxies, per request attempt. A 429 on one IP retries from another. Rate
limit and circuit breaker state are keyed per proxy, so each IP gets its own
budget and one failing proxy opens only its own circuit.

**Loop concurrency.** `for entry in shard concurrency 8` runs eight iterations
in flight. Without it a worker issues one request at a time and can't use the
egress it has. Iterations already get their own scope, so `response` and the
loop variable stay isolated.

**Sharding by input.** Each worker reads its own `fpl_shard` file and upserts
into one store. Shards are disjoint, so workers never contend.

**Batched writes.** `{ batch: 500 }` on the store buffers records and flushes
them in bulk, so a high-fan-out loop makes one store write per batch instead of
one per record - one DB round-trip per 500 managers rather than per manager,
which is what lets the store keep pace with the fetch. `durability: strict` (the
default) keeps each record durable before its loop iteration completes; `relaxed`
trades crash-safety of the in-flight buffer for more speed. Written as
`{ batch: { size: 500, maxDelay: 200, durability: relaxed } }` for the full form.

**Surviving a bad item.** A shard drawn from a stale id list contains managers
that no longer exist. `allow: [404]` returns that status as data instead of
retrying five times, and `404 -> skip` drops the item. A match written only on
statuses falls through when none apply, so a 200 carries on without needing a
`_` arm. Anything that still fails is queued to `failures` by `onError` rather
than killing a run that is most of the way through.

## Modeling the rate limit

`fallbackRpm` paces at a flat rate. That is safe but blunt: it either leaves the
server's burst allowance unused, or, set too high, drains it and eats 429s. Most
servers - FPL included, via OpenResty - enforce a **token bucket**: a full
bucket absorbs a burst, then sustained traffic above the refill rate is
throttled. Being resilient to that (retry, back off) is not the same as staying
under it.

If you know the bucket, declare it and reqon paces under it locally - using the
burst, holding the sustained rate, without tripping the limit:

```
rateLimit: {
  strategy: throttle,
  model: { type: tokenBucket, capacity: 5000, refill: 300, safety: 0.9 }
}
```

- `capacity` — how many requests a full bucket absorbs at once (the burst).
- `refill` — tokens the bucket regains per second (the sustained rate).
- `safety` — pace at this fraction of the modeled rate *and* burst for headroom
  against clock skew (optional, default 1.0).

reqon simulates the bucket with the same GCRA scheduler a rate limiter uses, per
egress lane, and releases a request only when the modeled bucket has a token.
Against a mock enforcing capacity 50 / refill 100 per second, a naive fixed
200/s took 452 × 429 out of 1000; the model took **zero**, while still using the
burst.

The model is only as good as its numbers. Calibrate `capacity` and `refill` to
the server: measure the burst (fire until the first 429), then the sustained
refill (ramp a steady rate until 429s begin). For FPL the burst is comfortably
into the thousands from one IP; the refill needs that steady-state measurement.
Until you have it, the conservative `fallbackRpm` is the safe default.

## Running it

No configuration required. It runs direct from your own IP, into a file store:

```bash
reqon examples/fpl-sharded/managers.vague --verbose
```

That is the right way to try it. Reach for the rest when the shard is big enough
that one IP won't do.

### With an egress pool

```bash
export FPL_USER_AGENT="your-project (you@example.com)"
export FPL_PROXY_1=http://user:pass@proxy-a:3128
export FPL_PROXY_2=http://user:pass@proxy-b:3128
export FPL_PROXY_3=http://user:pass@proxy-c:3128
export FPL_PROXY_4=http://user:pass@proxy-d:3128

reqon examples/fpl-sharded/managers.vague --verbose
```

Leave all four unset and the mission runs direct. Setting only some of them is
an error rather than a shorter pool: the missing entries would concentrate the
whole request rate onto whichever proxies did resolve, which is the failure the
pool exists to prevent.

Proxy support needs the optional peer dependency:

```bash
npm install undici
```

### As a fleet

Swap the file store for the shared table so every worker upserts into one place:

```
store managers: postgrest("fpl_manager_history")
```

The shard file lives at `.reqon-data/fpl_shard.json`, keyed by id:

```json
{
  "12": { "id": 12 },
  "97": { "id": 97 }
}
```

Reqon has no `range()` builtin, so the id list is an input. Whatever starts your
workers writes each shard file before the run.

## Orchestration

Reqon is the worker, not the scheduler. It doesn't provision machines and
doesn't hand work out. Anything that can start N processes with different env
vars will do: a Kubernetes Job with `completions: N, parallelism: N`, a GitHub
Actions matrix, Fly Machines, or N containers on one box each with a different
proxy slice.

Point every worker's execution log at the same Postgres and you get fleet-wide
progress and per-worker resume for free.

## Do you need one machine per shard?

Usually not, and it's the expensive answer. A proxy pool gives you egress
diversity from a single process, which is why `proxy:` exists on the source
rather than being something you solve with infrastructure. Separate machines
earn their cost when you need more concurrency than one process can drive, or
when your proxy provider bills per-egress in a way that makes VMs cheaper.

## Etiquette

Spreading requests across IPs to get around a per-IP limit is deliberately
routing around a control the API owner put there. FPL is public and the
community scrapes it constantly, so this isn't exotic, but be a good citizen:

- Set a real `User-Agent` with a contact address. It's already wired up here.
- Keep `fallbackRpm` conservative. It's per proxy, so the worker's total rate is
  `fallbackRpm x pool size`.
- Fetch overnight, and only re-fetch managers whose data actually changed.
- Cache. Manager history for a finished gameweek never changes again.

The polite version is usually also the cheaper version.
