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
into one shared PostgREST table. Shards are disjoint, so workers never contend.

## Running it

Each worker needs its shard and its slice of the pool:

```bash
export FPL_USER_AGENT="your-project (you@example.com)"
export FPL_PROXY_1=http://user:pass@proxy-a:3128
export FPL_PROXY_2=http://user:pass@proxy-b:3128
export FPL_PROXY_3=http://user:pass@proxy-c:3128
export FPL_PROXY_4=http://user:pass@proxy-d:3128

reqon examples/fpl-sharded/managers.vague --verbose
```

Proxy support needs the optional peer dependency:

```bash
npm install undici
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
