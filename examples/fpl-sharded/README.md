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

Being resilient to a rate limit (retry, back off) is not the same as staying
under it. A flat `fallbackRpm` is resilient but blunt: it either leaves the
server's burst allowance unused, or, set too high, drains it and eats 429s - and
it can't learn from those 429s. Most servers - FPL included, via OpenResty -
enforce a **token bucket**: a full bucket absorbs a burst, then sustained
traffic above the refill rate is throttled. Model that bucket and reqon paces
under it locally, using the burst and holding the sustained rate:

```
rateLimit: {
  strategy: throttle,
  model: { type: tokenBucket, capacity: 20, refill: 5, safety: 0.9 }
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

### The numbers are a ceiling, not a measurement

You almost never know a server's real limit exactly, and it shifts with load.
So the model self-calibrates: **an observed 429 tightens the offending lane
below the configured rate and holds it there; quiet time eases it back up.**
This matters most for a headerless limiter like FPL's - it sends no
`Retry-After`, so the 429 itself is the *only* feedback the client gets. (Before
this, a headerless 429 produced no client-side correction at all: the lane just
kept hammering the rate that had already failed.)

The practical consequence: pick `capacity` and `refill` as a best-guess ceiling
and let the run converge. Overshoot the sustained rate and the 429s pull it
back within a few requests; undershoot and you simply leave some throughput on
the table. The example's numbers (burst 20, ~5/s per proxy) are deliberately
conservative so it stays polite from one host - raise them toward the server's
true ceiling for a fleet. Keep `capacity` no larger than the burst you're
willing to fire *before* the first feedback arrives; the burst is the one part
adaptation can't walk back after the fact.

## How fast can this actually go?

FPL has on the order of 11-12M managers, so a full per-manager pull is ~12M
requests. Ten minutes is 600 seconds, i.e. a sustained **~20,000 requests/second
in aggregate**. That number is worth stating plainly because it sets the shape
of the whole operation:

- The bottleneck is not reqon. One worker process drives thousands of
  requests/second, and batched writes keep the store from becoming the ceiling.
- The bottleneck is FPL's **sustained per-IP rate**. A burst of several thousand
  per IP is fine; sustained load above the refill rate is where 429s begin, and
  that refill is realistically low (single-to-low-double-digit req/s per IP for
  a service fronted this way). Call it `R` req/s/IP sustained.
- So the pull needs roughly `20,000 / R` egress IPs held for ten minutes. At
  `R = 10` that's ~2,000 IPs; at `R = 2`, ~10,000. Either way it is a large,
  distributed operation whose whole point is to stay under a per-IP control by
  spreading across many IPs.

Be honest about what that is. Pulling a service's entire userbase in ten minutes
by fanning across thousands of IPs is the kind of thing an API's terms of use
generally prohibit, regardless of how politely each individual IP behaves. This
example is built to be *architecturally capable* of that scale - sharded
fan-out, per-IP budgets, batched ingest, a self-calibrating rate model - and to
default to the polite, single-host, direct-egress version. Treat 12M-in-10-min
as the design target the architecture must survive, not as a throughput to point
at FPL. The overnight, incremental, cached pull below gets you the same data
without being a denial-of-service in a trench coat.

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
- Keep the model conservative. `capacity`/`refill` are per proxy, so the
  worker's total rate is roughly `refill x pool size`; the self-calibration only
  ever paces *below* what you configure, never above it.
- Fetch overnight, and only re-fetch managers whose data actually changed.
- Cache. Manager history for a finished gameweek never changes again.

The polite version is usually also the cheaper version.
