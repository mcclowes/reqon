/**
 * ---
 * purpose: Vague plugin - registers Reqon keywords with Vague's lexer
 * exports:
 *   - reqonPlugin - plugin object for manual registration
 *   - registerReqonPlugin, unregisterReqonPlugin - registration helpers
 * related:
 *   - ./lexer/tokens.ts - REQON_KEYWORDS map
 *   - vague-lang - parent DSL framework
 * ---
 */

import {
  registerPlugin,
  unregisterPlugin,
  TokenType,
  type ParserContext,
  type PluginKeyword,
  type Statement as VagueStatement,
  type Token,
  type VaguePlugin,
} from 'vague-lang';
import type { Statement } from './ast/nodes.js';
import { ReqonTokenType, REQON_KEYWORDS } from './lexer/tokens.js';
import { ReqonParser } from './parser/parser.js';

/**
 * Convert REQON_KEYWORDS map to PluginKeyword array for Vague plugin system.
 */
function buildKeywords(): PluginKeyword[] {
  const keywords: PluginKeyword[] = [];

  for (const [keyword, tokenType] of Object.entries(REQON_KEYWORDS)) {
    keywords.push({
      keyword,
      tokenType: tokenType as string,
    });
  }

  return keywords;
}

/**
 * The Reqon plugin for Vague.
 *
 * Registers all Reqon keywords with Vague's lexer, allowing Vague's
 * lexer to tokenize Reqon source code.
 */
export const reqonPlugin: VaguePlugin = {
  name: 'reqon',
  keywords: buildKeywords(),
  statements: {
    [ReqonTokenType.MISSION]: parseBracedReqonStatement,
  },
};

/**
 * Let Vague's public parser consume a complete Reqon mission. Vague owns the
 * outer program and expression grammar; Reqon's parser owns the mission body.
 */
function parseBracedReqonStatement(ctx: ParserContext): VagueStatement {
  const tokens: Token[] = [];
  let depth = 0;
  let sawBody = false;

  while (!ctx.isAtEnd()) {
    const token = ctx.advance();
    tokens.push(token);
    if (token.type === TokenType.LBRACE) {
      sawBody = true;
      depth++;
    } else if (token.type === TokenType.RBRACE && sawBody) {
      depth--;
      if (depth === 0) break;
    }
  }

  if (!sawBody || depth !== 0) throw ctx.error('Unterminated Reqon mission');
  const last = tokens.at(-1)!;
  tokens.push({ type: TokenType.EOF, value: '', line: last.line, column: last.column + 1 });
  const statement: Statement | undefined = new ReqonParser(tokens).parse().statements[0];
  if (!statement) throw ctx.error('Reqon mission did not produce a statement');
  return statement as unknown as VagueStatement;
}

let isRegistered = false;

/**
 * Register Reqon with Vague's plugin system.
 * Safe to call multiple times - will only register once.
 */
export function registerReqonPlugin(): void {
  if (!isRegistered) {
    registerPlugin(reqonPlugin);
    isRegistered = true;
  }
}

/**
 * Unregister Reqon from Vague's plugin system.
 */
export function unregisterReqonPlugin(): void {
  if (isRegistered) {
    unregisterPlugin('reqon');
    isRegistered = false;
  }
}

/**
 * Check if Reqon plugin is currently registered.
 */
export function isReqonPluginRegistered(): boolean {
  return isRegistered;
}

// Auto-register on import
registerReqonPlugin();
