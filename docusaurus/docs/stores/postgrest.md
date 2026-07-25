---
sidebar_position: 4
---

# PostgREST store

The PostgREST store adapter connects to PostgreSQL via PostgREST or Supabase, for production-ready SQL storage.

## Configuration

### Mission file

Declare the store in your mission:

```vague
store items: postgrest("items")
store users: postgrest("users")
```

The string is the table name. A `postgrest` store needs connection options that
aren't expressed in the DSL, so you wire them up programmatically (see below).

### Programmatic setup

There's no store-config CLI flag. Build a configured PostgREST adapter with
`createStore`, then pass it in under the store's name. The adapter you supply
overrides whatever the mission declared for that name:

```typescript
import { createStore, fromFile } from 'reqon';

const items = createStore({
  type: 'postgrest',
  name: 'items', // table name
  postgrest: {
    url: 'https://your-project.supabase.co/rest/v1',
    apiKey: process.env.SUPABASE_ANON_KEY!,
  },
});

await fromFile('mission.reqon', {
  // keyed by the store name from the mission (`store items: ...`)
  stores: { items },
});
```

### Options

`createStore`'s `postgrest` options map to the adapter:

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `url` | Yes | — | Base URL of the PostgREST API (e.g. `https://xxx.supabase.co/rest/v1`) |
| `apiKey` | Yes | — | API key, sent as both the `apikey` header and a bearer token |
| `primaryKey` | No | `id` | Primary-key column used to look up and upsert records |
| `schema` | No | — | Postgres schema, sent as `Accept-Profile`/`Content-Profile` (e.g. `public`) |
| `timeoutMs` | No | `30000` | Per-request timeout; the request is aborted once it elapses |
| `allowFullTableClear` | No | `false` | Opt-in guard for `clear()`, which issues a full-table delete |

The table name comes from `name` (set from the store declaration), not from these options.

## Supabase setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your project URL and anon key

### 2. Create tables

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Configure the adapter

```typescript
const items = createStore({
  type: 'postgrest',
  name: 'items',
  postgrest: {
    url: 'https://abc123.supabase.co/rest/v1',
    apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  },
});
```

## Self-hosted PostgREST

### Docker setup

```yaml
# docker-compose.yml
version: '3'
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  postgrest:
    image: postgrest/postgrest
    environment:
      PGRST_DB_URI: postgres://postgres:secret@db:5432/postgres
      PGRST_DB_ANON_ROLE: anon
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

### Configuration

```typescript
const items = createStore({
  type: 'postgrest',
  name: 'items',
  postgrest: {
    url: 'http://localhost:3000',
    apiKey: 'your-jwt-or-role-key',
  },
});
```

`apiKey` is always required by the adapter. For a self-hosted instance, pass the
key your PostgREST is configured to accept.

## Operations

### Write

```vague
// Insert (upsert on primary key)
store response -> items { key: .id }

// Upsert
store response -> items { key: .id, upsert: true }

// Partial update (deep merge, same as upsert)
store response -> items { key: .id, partial: true }
```

`set` uses PostgREST's `resolution=merge-duplicates`, so a plain write also upserts on the primary key.

### Read

```vague
for item in items { }
for item in items where .status == "active" { }
```

## Query mapping

Where clauses are equality-only. Each field becomes a PostgREST equality filter:

| Reqon | PostgREST |
|-------|-----------|
| `.field == "value"` | `?field=eq.value` |
| `.field == null` | `?field=is.null` |

Other operators (not-equal, greater-than, less-than, and so on) aren't translated.
Filter on what you can express as equality, then narrow further in your action logic.

## Authentication

The `apiKey` is sent as both the `apikey` header and an `Authorization: Bearer`
token. For Supabase, use the anon key for row-level-security-scoped access or the
service-role key for full access:

```typescript
// Anon key — subject to RLS policies
const items = createStore({
  type: 'postgrest',
  name: 'items',
  postgrest: { url: 'https://abc.supabase.co/rest/v1', apiKey: 'anon-key' },
});

// Service-role key — full access
const itemsAdmin = createStore({
  type: 'postgrest',
  name: 'items',
  postgrest: { url: 'https://abc.supabase.co/rest/v1', apiKey: 'service-role-key' },
});
```

## Clearing a table

`clear()` issues a full-table delete and is disabled by default. Opt in explicitly:

```typescript
const items = createStore({
  type: 'postgrest',
  name: 'items',
  postgrest: {
    url: 'https://abc.supabase.co/rest/v1',
    apiKey: 'service-role-key',
    allowFullTableClear: true,
  },
});
```

## Best practices

### Table design

```sql
CREATE TABLE items (
  -- Use text ID for compatibility
  id TEXT PRIMARY KEY,

  -- Store full record as JSONB
  data JSONB NOT NULL,

  -- Add common query fields
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index common queries
CREATE INDEX items_status_idx ON items(status);
CREATE INDEX items_created_idx ON items(created_at);
```

### Upsert with timestamps

```sql
-- Add a trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

## Troubleshooting

### "Relation does not exist"

The table hasn't been created:

```sql
CREATE TABLE your_table (...);
```

### "Permission denied"

Check your RLS policies:

```sql
CREATE POLICY "Allow all" ON items FOR ALL USING (true);
```

### Connection issues

Verify the URL and credentials:

```bash
curl -H "apikey: your-key" https://abc.supabase.co/rest/v1/items
```
