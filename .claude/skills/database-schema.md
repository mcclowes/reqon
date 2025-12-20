# Database Schema Skill

Use this skill when working on SQL/NoSQL store adapters or database-related functionality in Reqon.

## Capabilities

### Generating Store Implementations
- Create PostgreSQL store adapters implementing the `StoreAdapter` interface from `src/stores/types.ts`
- Create MySQL store adapters with appropriate driver usage
- Create MongoDB/DynamoDB NoSQL adapters

### Creating Migration Files
- Generate SQL migration files for schema creation
- Create up/down migration pairs for reversibility
- Handle incremental schema changes

### Type Mapping
Map Reqon/Vague DSL types to database column types:

| DSL Type | PostgreSQL | MySQL | MongoDB |
|----------|------------|-------|---------|
| string | TEXT/VARCHAR | VARCHAR | String |
| number | NUMERIC/INTEGER | DECIMAL/INT | Number |
| boolean | BOOLEAN | TINYINT(1) | Boolean |
| array | JSONB | JSON | Array |
| object | JSONB | JSON | Object |
| date | TIMESTAMP | DATETIME | Date |

## Context Files
When using this skill, read:
- `src/stores/types.ts` - StoreAdapter interface
- `src/stores/memory.ts` - Reference implementation
- `src/ast/nodes.ts` - Schema and type definitions

## Implementation Patterns

### Store Adapter Structure
```typescript
import { StoreAdapter, StoreRecord } from './types';

export class PostgresStore implements StoreAdapter {
  async get(key: string): Promise<StoreRecord | undefined> { }
  async set(key: string, value: StoreRecord): Promise<void> { }
  async delete(key: string): Promise<boolean> { }
  async query(filter: Record<string, unknown>): Promise<StoreRecord[]> { }
  async upsert(key: string, value: StoreRecord): Promise<void> { }
}
```

### Migration File Naming
Use timestamp-based naming: `YYYYMMDDHHMMSS_description.sql`
