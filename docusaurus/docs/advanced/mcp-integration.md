---
sidebar_position: 5
description: Integrate Reqon with AI assistants via the Model Context Protocol (MCP) server for AI-driven data pipeline execution and querying.
keywords: [reqon, MCP, Model Context Protocol, Claude, AI, integration]
---

# MCP Integration

Reqon includes a Model Context Protocol (MCP) server that exposes pipeline capabilities to AI assistants like Claude. This enables AI-driven data pipeline execution and querying.

## Overview

The MCP server provides:

- **Tools** for executing missions and querying stores
- **Resources** for accessing stored data
- Integration with Claude Desktop and other MCP clients

## Starting the Server

### Command Line

```bash
npx reqon-mcp-server

# With options
npx reqon-mcp-server --verbose --cwd /path/to/project
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "reqon": {
      "command": "npx",
      "args": ["reqon-mcp-server"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

## Available Tools

### reqon.execute

Execute a mission from DSL source code:

```
Tool: reqon.execute
Parameters:
  source: string    - Reqon DSL source code
  verbose: boolean  - Enable verbose logging (default: false)
  dryRun: boolean   - Validate without HTTP requests (default: false)
```

Example usage in Claude:

```
Execute this Reqon mission:

mission FetchUsers {
  source API { auth: bearer, base: "https://api.example.com" }
  store users: memory

  action Fetch {
    get "/users"
    for user in response.users {
      store user -> users { key: .id }
    }
  }

  run Fetch
}
```

### reqon.execute_file

Execute a mission from a file or folder:

```
Tool: reqon.execute_file
Parameters:
  path: string      - Path to .reqon file or mission folder
  verbose: boolean  - Enable verbose logging (default: false)
  dryRun: boolean   - Validate without HTTP requests (default: false)
```

### reqon.parse

Parse DSL source and return AST structure:

```
Tool: reqon.parse
Parameters:
  source: string    - Reqon DSL source code to parse
```

Returns a summary of the parsed structure:

```json
{
  "type": "ReqonProgram",
  "statements": 1,
  "missions": [
    {
      "name": "SyncCustomers",
      "sources": 1,
      "stores": 2,
      "actions": 3,
      "hasSchedule": true
    }
  ]
}
```

### reqon.query_store

Query data from a registered store:

```
Tool: reqon.query_store
Parameters:
  store: string     - Name of the store to query
  filter: object    - Filter criteria (optional)
    where: object   - Field equality conditions
    limit: number   - Maximum records to return
    offset: number  - Number of records to skip
```

Example:

```
Query the "customers" store for active users:
- store: customers
- filter: { where: { status: "active" }, limit: 10 }
```

### reqon.list_stores

List all registered stores and their record counts:

```
Tool: reqon.list_stores
Parameters: (none)
```

Returns:

```json
{
  "stores": [
    { "name": "customers", "count": 150 },
    { "name": "orders", "count": 1250 }
  ],
  "total": 2
}
```

### reqon.register_store

Register a store for cross-execution access:

```
Tool: reqon.register_store
Parameters:
  name: string      - Store name for reference
  type: string      - Store type: "memory" or "file"
  path: string      - File path for file-based stores (optional)
```

## Available Resources

### reqon://stores

List all registered stores:

```
Resource: reqon://stores
Returns: JSON array of store names and counts
```

### reqon://stores/\{name\}

Access data from a specific store:

```
Resource: reqon://stores/customers
Returns: JSON with store data (limit 100 records)
```

## Use Cases

### AI-Driven Data Sync

Claude can execute data sync pipelines based on user requests:

```
User: "Sync the latest invoices from Xero and store them locally"

Claude: I'll execute a Reqon mission to sync invoices...
[Uses reqon.execute with appropriate mission source]
```

### Interactive Data Exploration

Query and explore synced data:

```
User: "Show me the top 10 customers by order count"

Claude: Let me query the customers store...
[Uses reqon.query_store with filter]
```

### Pipeline Validation

Validate mission syntax before execution:

```
User: "Check if this mission is valid: [source code]"

Claude: I'll parse this mission to validate...
[Uses reqon.parse to check for errors]
```

## Server Architecture

```
┌─────────────────────────────────────────┐
│           MCP Client (Claude)            │
└─────────────────┬───────────────────────┘
                  │ stdio
┌─────────────────▼───────────────────────┐
│          Reqon MCP Server               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Tools  │ │Resources│ │ Stores  │   │
│  └────┬────┘ └────┬────┘ └────┬────┘   │
│       │           │           │         │
│       └───────────┴───────────┘         │
│                   │                     │
│        ┌──────────▼──────────┐         │
│        │   Reqon Runtime     │         │
│        │  (parse, execute)   │         │
│        └─────────────────────┘         │
└─────────────────────────────────────────┘
```

## Configuration

### Working Directory

Set the working directory for file operations:

```bash
reqon-mcp-server --cwd /path/to/missions
```

### Verbose Mode

Enable detailed logging:

```bash
reqon-mcp-server --verbose
```

## Security Considerations

- The MCP server executes missions with full network access
- Store data is held in memory during the server session
- File stores persist to the filesystem
- Consider access controls when exposing to AI assistants

## Error Handling

Tool errors return structured responses:

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Error: Store \"unknown\" not found. Available stores: customers, orders"
  }]
}
```

## Integration Example

Complete workflow with Claude:

1. **Register stores** for the session:
   ```
   Register a "products" store of type "memory"
   ```

2. **Execute a mission** to populate data:
   ```
   Execute this mission to fetch products:
   [mission source]
   ```

3. **Query the results**:
   ```
   Show me products with price > 100
   ```

4. **Export or process** the data:
   ```
   Transform and export these products to CSV format
   ```
