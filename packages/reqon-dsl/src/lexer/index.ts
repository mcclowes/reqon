/**
 * ---
 * purpose: Lexer module - wraps Vague lexer with Reqon keywords
 * note: Importing this module auto-registers Reqon plugin with Vague
 * exports:
 *   - ReqonLexer (alias for Vague Lexer)
 *   - ReqonTokenType, REQON_KEYWORDS
 * related:
 *   - ./tokens.ts - Reqon-specific keywords (mission, action, fetch, etc.)
 *   - ../plugin.ts - registers keywords with Vague
 *   - ../parser/index.ts - consumes tokens
 * ---
 */

// Import plugin to auto-register Reqon keywords with Vague
import '../plugin.js';

// Re-export Vague's TokenType and Token type
export { TokenType, type Token } from 'vague-lang';

// Reqon's lexer extends Vague's lexer with `!=` / `!` operator support.
// Exported under both names so all consumers (parser, loader, benchmarks,
// tests) get the enhanced lexer.
export { ReqonLexer, ReqonLexer as Lexer } from './lexer.js';

export { ReqonTokenType, REQON_KEYWORDS } from './tokens.js';

// Re-export Token type with Reqon compatibility alias
export type { Token as ReqonToken } from 'vague-lang';
