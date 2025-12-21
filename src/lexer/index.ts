/**
 * Lexer module for Reqon.
 *
 * Uses Vague's Lexer with Reqon keywords registered via the plugin system.
 * Importing this module automatically registers the Reqon plugin.
 */

// Import plugin to auto-register Reqon keywords with Vague
import '../plugin.js';

// Re-export Vague's Lexer and TokenType as the primary lexer
export { Lexer, Lexer as ReqonLexer, TokenType, type Token } from 'vague-lang';

// Export Reqon-specific token types and keywords
export { ReqonTokenType, REQON_KEYWORDS } from './tokens.js';

// Re-export Token type with Reqon compatibility alias
export type { Token as ReqonToken } from 'vague-lang';
