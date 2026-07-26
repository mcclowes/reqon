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

**Batched writes (for the networked store).** `batch` buffers records and
flushes them in bulk, turning 500 row-at-a-time round-trips into one array POST.
That's a real win against **PostgREST** in a fleet; against a file store it buys
little (each flush rewrites the whole file), which is why the runnable default
here is a plain `file(...)`. And it has a sharp edge worth stating plainly:
`durability: strict` (the default) holds each write until its batch flushes, so
if the batch `size` exceeds the loop's `concurrency` the batch never fills by
size and every flush waits on the 100ms timer - which *caps* throughput at
roughly `concurrency x 10/s`. `durability: relaxed` resolves each write
immediately so the fan-out runs at full speed and the batch fills in the
background, at the cost of crash-safety for the in-flight buffer. See
[Throughput, measured](#throughput-measured) for the numbers. For a fleet:
`postgrest("fpl_manager_history") { batch: { size: 500, durability: relaxed } }`.

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

- The bottleneck is not reqon. One worker process drives well over ten thousand
  requests/second through the full fetch → map → store pipeline (mock numbers
  below), and ~2,200 req/s against live FPL from a single IP (measured below).
- The gate is FPL's **per-IP rate**, and it's higher than you'd guess. Measured
  from one IP: FPL absorbs a **burst of ~5,000-7,000 requests** before the first
  429, then sustains **~1,800-2,000 req/s** with only a ~10-15% 429 trickle. Call
  the sustained figure `R`; here `R ≈ 1,800`.
- So the pull needs roughly `20,000 / R` egress IPs held for ten minutes - about
  **a dozen IPs**, paced to maybe ~20-25 to keep a clean margin below the limit.
  Not the thousands an earlier, pessimistic guess implied.

So 12M-in-10-min is genuinely feasible, on a couple dozen IPs rather than a
data-center. That does not make it *polite*: it is still pulling a service's
entire userbase as fast as its limiter allows, which its terms of use generally
frown on however few IPs you spread it over. This example is built to be capable
of that scale - sharded fan-out, per-IP budgets, batched ingest, a
self-calibrating rate model - and to default to the polite, single-host,
direct-egress version. Treat 12M-in-10-min as the design target the architecture
must survive, not as a throughput to point at FPL. The overnight, incremental,
cached pull below gets you the same data without hammering anyone.

> Measured live from one IP on 2026-07-26, via reqon's own `HttpClient` (no
> client throttle, no retry, 429s counted as data): 2 ramp + 3 sustained runs,
> ~400 induced 429s total. FPL sends no rate-limit headers, so these are
> black-box observations - the burst depth and refill vary run to run and with
> FPL's load, and can change without notice. Treat `R ≈ 1,800/s/IP` as an
> order-of-magnitude fact (hundreds-to-thousands, not single digits), not a
> constant to hard-code.

### Throughput, measured

Numbers for the pipeline itself - the real CLI running `managers.vague`-shaped
missions against a **zero-latency local mock** (loopback, no rate limit), so this
is the code's ceiling, not what you'd see over the wire. 5,000 requests:

| concurrency | store                          | req/s   |
| ----------- | ------------------------------ | ------- |
| 8           | memory                         | ~16,000 |
| 8           | file, `batch` **relaxed**      | ~16,900 |
| 8           | file, plain (this example)     | ~740    |
| 8           | file, `batch: 500` **strict**  | ~72     |
| 512         | file, plain                    | ~13,000 |
| 512         | file, `batch: 500` strict      | ~13,900 |

Two things to read off this:

- **The pipeline ceiling is ~16k req/s per process**, reached with an in-memory
  store or a relaxed-durability batch. It is never the constraint against a
  rate-limited API.
- **`batch: 500` in strict mode at low concurrency is a trap** - 72 req/s, 10×
  *slower* than no batching. The batch (500) never fills at concurrency 8, so
  every flush waits the 100ms timer. Match the batch size to your concurrency, or
  use `durability: relaxed`, and batching helps instead of hurting. This is why
  the runnable example uses a plain file store.

Over the real network none of these is the limit anyway: effective throughput is
`concurrency / round-trip-latency`, and then FPL's per-IP rate sits below that.
The store numbers matter only so you don't hobble a worker with a batch config
that's slower than no batch at all.

And against **live FPL** from one IP (reqon's own `HttpClient`, ~21-30ms
round-trip, no client throttle):

| what                              | measured                                        |
| --------------------------------- | ----------------------------------------------- |
| burst before first 429            | ~5,000-7,000 requests                           |
| sustained accept rate             | ~1,800-2,000 req/s (≈10-15% 429 above that)     |
| reqon's achieved rate @ conc 48   | ~2,200 req/s (concurrency-bound, not FPL-bound) |

The achieved rate rose with concurrency until it met FPL's limiter at roughly
the same place - so from one IP, one worker at a few dozen in-flight requests
saturates what FPL will give it. More per IP just buys 429s; more throughput
means more IPs.

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

Swap the file store for the shared table so every worker upserts into one place,
and batch the writes so each flush is one array POST rather than 500 round-trips:

```
store managers: postgrest("fpl_manager_history") { batch: { size: 500, durability: relaxed } }
```

`relaxed` matters here: with the default `strict` and a batch larger than the
loop's concurrency, every flush waits the 100ms timer (see
[Throughput, measured](#throughput-measured)). Relaxed lets the fan-out run at
full speed and the batch fill by size; the trade is crash-safety of the in-flight
buffer, which a resumable, idempotent-upsert run can afford.

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
