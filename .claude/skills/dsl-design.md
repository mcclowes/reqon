# Language/DSL Design Skill

Use this skill when extending Reqon's DSL syntax, implementing new language constructs, or working on the lexer/parser.

## Architecture Overview

Reqon extends Vague's language infrastructure:
- **Vague** provides: lexer base, expression syntax, match expressions, core AST
- **Reqon** adds: mission/action/fetch/store constructs, execution semantics

## Capabilities

### Implementing New DSL Constructs
- Add new keywords to `src/lexer/tokens.ts`
- Extend the lexer in `src/lexer/lexer.ts`
- Add parser rules in `src/parser/parser.ts`
- Define AST nodes in `src/ast/nodes.ts`

### Writing Parser Tests
- Create comprehensive test cases in `src/parser/parser.test.ts`
- Test edge cases and error conditions
- Use Vitest's describe/it/expect patterns

### Generating Better Error Messages
- Include line and column numbers in parse errors
- Provide context about what was expected
- Suggest fixes for common mistakes

## Context Files
When using this skill, read:
- `src/lexer/tokens.ts` - Token definitions
- `src/lexer/lexer.ts` - Lexer implementation
- `src/parser/parser.ts` - Main parser
- `src/parser/base.ts` - Parser utilities
- `src/ast/nodes.ts` - AST node types

## Implementation Patterns

### Adding a New Keyword
1. Add token type to `ReqonTokenType` enum in `tokens.ts`
2. Add keyword mapping in `REQON_KEYWORDS` in `lexer.ts`
3. Add parsing logic in `parser.ts`
4. Define AST node in `nodes.ts`

### Token Definition Pattern
```typescript
export enum ReqonTokenType {
  // ... existing tokens
  NEW_KEYWORD = 'NEW_KEYWORD',
}

export const REQON_KEYWORDS: Record<string, ReqonTokenType> = {
  // ... existing keywords
  'newkeyword': ReqonTokenType.NEW_KEYWORD,
};
```

### Parser Rule Pattern
```typescript
private parseNewConstruct(): NewConstructNode {
  this.expect(ReqonTokenType.NEW_KEYWORD);
  const name = this.parseIdentifier();
  // ... parse body
  return { type: 'NewConstruct', name, ... };
}
```

### Error Message Pattern
```typescript
throw new ParseError(
  `Expected ${expected} but found ${actual}`,
  { line: token.line, column: token.column }
);
```

## Planned Constructs (from TODO.md)
- `is` type checking: `assume .items is array`
- Parallel execution: `run Step1, Step2 then Step3`
- Conditional actions: `run Step1 then Step2 if condition`
- Variables/let bindings: `let x = expression`
