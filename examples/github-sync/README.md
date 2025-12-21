# GitHub Sync Example

Demonstrates multi-file missions, parallel execution, and error handling with flow control.

## Folder Structure

This mission is organized as a folder with separate action files:

```
github-sync/
├── mission.vague       # Main file: sources, stores, schemas, pipeline
├── fetch-issues.vague  # Fetches issues with pagination and error handling
├── fetch-prs.vague     # Fetches pull requests with error handling
├── normalize.vague     # Normalizes to unified schema
└── README.md
```

## What it does

1. **FetchIssues** and **FetchPRs** run in **parallel** to fetch data concurrently
2. **Normalize** runs after both complete, unifying issues and PRs into `work_items`

## Run

```bash
# Run from folder path
node dist/cli.js examples/github-sync --auth credentials.json --verbose

# Environment variables needed
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo
```

Requires a `credentials.json`:
```json
{
  "GitHub": {
    "type": "bearer",
    "token": "ghp_your_github_token"
  }
}
```

## Features demonstrated

### Multi-file Missions
- `mission.vague` contains sources, stores, schemas, and pipeline
- Action files (`fetch-issues.vague`, etc.) are automatically discovered and merged
- Actions can reference stores and schemas defined in the root file

### Parallel Execution
```vague
run [FetchIssues, FetchPRs] then Normalize
```
- `[FetchIssues, FetchPRs]` runs both actions concurrently
- `then Normalize` waits for both to complete before running

### Schema Overloading with Match Steps
```vague
match response {
  [GitHubIssue] -> { store response -> issues_raw },
  RateLimitError -> retry { maxAttempts: 5 },
  NotFoundError -> abort "Repository not found",
  _ -> skip
}
```

### Flow Control Directives
- `continue` - Proceed to next step
- `skip` - Skip remaining steps in current action
- `abort "message"` - Halt mission with error
- `retry { ... }` - Retry with backoff configuration
- `queue target` - Send to dead-letter queue
- `jump ActionName then retry` - Execute another action, then retry
