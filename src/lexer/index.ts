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

// Re-export Vague's Lexer and TokenType as the primary lexer
export { Lexer, Lexer as ReqonLexer, TokenType, type Token } from 'vague-lang';

// Export Reqon-specific token types and keywords
export { ReqonTokenType, REQON_KEYWORDS } from './tokens.js';

// Re-export Token type with Reqon compatibility alias
export type { Token as ReqonToken } from 'vague-lang';
