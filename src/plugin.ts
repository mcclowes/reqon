/**
 * Reqon plugin for Vague.
 *
 * This plugin registers Reqon's keywords and statement parsers with Vague,
 * allowing Vague to parse Reqon syntax when the plugin is registered.
 *
 * Usage:
 *   import { registerPlugin } from 'vague-lang';
 *   import { reqonPlugin } from 'reqon';
 *   registerPlugin(reqonPlugin);
 *
 * Or simply import the plugin module to auto-register:
 *   import 'reqon/plugin';
 */

import {
  registerPlugin,
  unregisterPlugin,
  type VaguePlugin,
  type PluginKeyword,
} from 'vague-lang';
import { REQON_KEYWORDS } from './lexer/tokens.js';

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
  // Statement parsers will be added when we refactor ReqonParser
};

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
