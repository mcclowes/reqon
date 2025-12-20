# VS Code Extension Skill

Use this skill when creating or enhancing VS Code support for Reqon's `.reqon` files.

## Capabilities

### TextMate Grammar
Create syntax highlighting for `.reqon` files:
- Keywords: mission, source, store, action, fetch, map, validate, run, then, for, in, where, match, assume
- Auth types: oauth2, bearer, basic, api_key
- Store types: memory, sql, nosql
- Operators: ->, =, :, |
- Strings, numbers, identifiers
- Comments

### Language Server Protocol (LSP)
Implement language intelligence:
- Syntax error diagnostics
- Hover information for keywords
- Go to definition for actions/missions
- Autocomplete for keywords and identifiers
- Document symbols outline

### Snippet Generation
Create snippets for common patterns:
- Mission template
- Source definition
- Store definition
- Fetch with pagination
- Map transformation
- Validate block

## Context Files
When using this skill, read:
- `src/lexer/tokens.ts` - All token types and keywords
- `src/ast/nodes.ts` - AST structure for symbols
- `src/parser/parser.ts` - Syntax rules

## Implementation Patterns

### TextMate Grammar Structure
```json
{
  "name": "Reqon",
  "scopeName": "source.reqon",
  "fileTypes": ["reqon"],
  "patterns": [
    { "include": "#keywords" },
    { "include": "#strings" },
    { "include": "#comments" }
  ],
  "repository": {
    "keywords": {
      "match": "\\b(mission|source|store|action|fetch|map|validate|run|then|for|in|where|match|assume)\\b",
      "name": "keyword.control.reqon"
    }
  }
}
```

### Extension package.json
```json
{
  "name": "reqon-vscode",
  "displayName": "Reqon",
  "contributes": {
    "languages": [{
      "id": "reqon",
      "extensions": [".reqon"],
      "configuration": "./language-configuration.json"
    }],
    "grammars": [{
      "language": "reqon",
      "scopeName": "source.reqon",
      "path": "./syntaxes/reqon.tmLanguage.json"
    }]
  }
}
```

### Snippet Format
```json
{
  "Mission": {
    "prefix": "mission",
    "body": [
      "mission ${1:Name} {",
      "  source ${2:api} {",
      "    url: \"${3:https://api.example.com}\"",
      "    auth: ${4:bearer} { token: \"${5:\\$API_TOKEN}\" }",
      "  }",
      "",
      "  action ${6:FetchData} {",
      "    fetch ${7:/endpoint}",
      "  }",
      "}"
    ]
  }
}
```

## Directory Structure
```
reqon-vscode/
├── package.json
├── language-configuration.json
├── syntaxes/
│   └── reqon.tmLanguage.json
├── snippets/
│   └── reqon.json
└── src/
    └── extension.ts  # LSP client
```
