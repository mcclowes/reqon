# PostgREST Sync Example

Syncs data from an external API into PostgreSQL through
[PostgREST](https://postgrest.org) (which also backs Supabase). Unlike `sql()`
and `nosql()`, `postgrest()` is a **real, database-backed** store adapter — it's
the recommended option for production persistence.

## What it does

1. `SyncUsers` — fetches users from an API, maps them to `User` and
   `UserProfile` schemas, and upserts both into PostgREST-backed tables. Each
   sync writes an entry to an `audit_log` table.
2. `ProcessActiveUsers` — iterates the `users` store, filtering out inactive
   roles, and logs a processing event per active user.
3. `UpdateUserStatus` — pulls incremental status updates (`since: lastSync`) and
   applies **partial** updates (only the changed fields) to existing rows.

## Run

```bash
node dist/cli.js examples/postgrest-sync/sync.vague --verbose
```

You need a running PostgREST server (default `http://localhost:3000`) with
`users`, `user_profiles`, and `audit_log` tables, plus a bearer token for it.

## Features demonstrated

- `postgrest("table")` store — PostgreSQL via PostgREST/Supabase
- `upsert: true` — insert-or-update on the key
- `partial: true, upsert: false` — update only the given fields, and only if the
  row already exists
- `since: lastSync` — incremental fetch with automatic checkpointing
- Composite, self-describing keys built with `concat(...)` and `timestamp()`
  (rather than a random id) so audit rows stay unique and inspectable

## Notes

- Store contents can only be read by iterating with `for ... in <store>` — there
  is no inline `store[key]` lookup, so `ProcessActiveUsers` iterates and filters
  rather than joining stores by key.
