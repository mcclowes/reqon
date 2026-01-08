/**
 * AI-powered documentation review module
 *
 * Uses Anthropic AI to periodically review Vague documentation
 * and identify changes needed in the Reqon implementation.
 */

export { DocumentationAnalyzer, type ChangeCheckResult } from './analyzer.js';
export { AnthropicClient } from './anthropic-client.js';
export { VagueDocFetcher, fetchReqonContext } from './doc-fetcher.js';
export { ReviewReporter } from './reporter.js';
export { ReviewStateStore, type ReviewState } from './state.js';
export * from './types.js';
