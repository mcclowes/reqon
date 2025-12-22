---
sidebar_position: 4
---

# PostgREST Store

The PostgREST store adapter connects to PostgreSQL via PostgREST or Supabase, enabling production-ready SQL storage.

## Configuration

### Mission file

```vague
store items: sql("items")
store users: sql("users")
```

### Store configuration

Create `stores.json`:

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://your-project.supabase.co/rest/v1",
    "apiKey": "your-anon-key"
  }
}
```

Run with:

```bash
reqon mission.vague --store-config ./stores.json
```

## Supabase setup

### 1. Create Supabase project

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

### 3. Configure Reqon

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://abc123.supabase.co/rest/v1",
    "apiKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
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

```json
{
  "sql": {
    "type": "postgrest",
    "url": "http://localhost:3000"
  }
}
```

## Operations

### Write

```vague
// Insert
store response -> items { key: .id }

// Upsert
store response -> items { key: .id, upsert: true }

// Partial update
store response -> items { key: .id, partial: true }
```

### Read

```vague
for item in items { }
for item in items where .status == "active" { }
```

### Delete

```vague
delete items[item.id]
```

## Query mapping

Reqon where clauses map to PostgREST queries:

| Reqon | PostgREST |
|-------|-----------|
| `.field == "value"` | `?field=eq.value` |
| `.field != "value"` | `?field=neq.value` |
| `.field > 10` | `?field=gt.10` |
| `.field >= 10` | `?field=gte.10` |
| `.field < 10` | `?field=lt.10` |
| `.field <= 10` | `?field=lte.10` |

## Authentication

### Anon key

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://abc.supabase.co/rest/v1",
    "apiKey": "anon-key"
  }
}
```

### Service role key

For full access:

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://abc.supabase.co/rest/v1",
    "apiKey": "service-role-key"
  }
}
```

### Row level security

With RLS enabled:

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://abc.supabase.co/rest/v1",
    "apiKey": "anon-key",
    "headers": {
      "Authorization": "Bearer user-jwt"
    }
  }
}
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
-- Add trigger for updated_at
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

### Connection pooling

For high-volume usage:

```json
{
  "sql": {
    "type": "postgrest",
    "url": "https://abc.supabase.co/rest/v1",
    "apiKey": "...",
    "poolSize": 10
  }
}
```

## Error handling

```vague
action SafeStore {
  get "/items"

  for item in response.items {
    match {
      _ where true -> {
        store item -> items { key: .id }
      }
    } catch {
      { code: 23505 } -> skip,  // Unique violation
      { code: 23503 } -> skip,  // Foreign key violation
      _ -> queue errors { item: { id: item.id, error: "Store failed" } }
    }
  }
}
```

## Monitoring

### Query logs

Enable in Supabase Dashboard or PostgREST config.

### Performance

```sql
-- Check slow queries
SELECT * FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

## Troubleshooting

### "Relation does not exist"

Table hasn't been created:

```sql
CREATE TABLE your_table (...);
```

### "Permission denied"

Check RLS policies:

```sql
CREATE POLICY "Allow all" ON items FOR ALL USING (true);
```

### Connection issues

Verify URL and credentials:

```bash
curl -H "apikey: your-key" https://abc.supabase.co/rest/v1/items
```
