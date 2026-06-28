#!/usr/bin/env node

/**
 * CLI for AI documentation review
 *
 * Usage:
 *   reqon-ai-review [options]
 *
 * Options:
 *   --verbose         Enable verbose logging
 *   --output <dir>    Output directory for reports
 *   --model <model>   Anthropic model to use
 *   --format <fmt>    Output format: console, json, markdown
 *   --list            List previous reports
 *   --show <file>     Show a specific report
 *   --check-only      Only check for changes, don't run review
 *   --force           Run review even if no changes detected
 *   --help            Show help
 */

import { resolve } from 'node:path';
import { DocumentationAnalyzer } from './analyzer.js';
import { ReviewReporter } from './reporter.js';
import type { AIReviewConfig } from './types.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
AI Documentation Review for Reqon

Reviews Vague documentation using Anthropic AI to identify
changes needed in the Reqon implementation.

Usage:
  npx tsx src/ai-review/cli.ts [options]
  reqon-ai-review [options]  (after build)

Options:
  --verbose           Enable verbose logging
  --output <dir>      Output directory for reports (default: .reqon-data/ai-reviews)
  --model <model>     Anthropic model (default: claude-sonnet-4-20250514)
  --format <fmt>      Output format: console, json, markdown (default: console)
  --list              List previous reports
  --show <file>       Show a specific previous report
  --save              Save the report to disk
  --check-only        Only check if Vague has changed, don't run AI review
  --force             Run review even if no changes detected since last review
  --help, -h          Show this help message

Environment Variables:
  ANTHROPIC_API_KEY   Required (except for --check-only). Your Anthropic API key
  GITHUB_TOKEN        Optional. GitHub token for higher rate limits

Exit Codes:
  0   No changes needed (or no changes detected with --check-only)
  1   Changes needed (non-critical) or changes detected with --check-only
  2   Critical changes needed
  3   Skipped (no changes since last review)

Examples:
  # Check if Vague has changed (no API key needed)
  npx tsx src/ai-review/cli.ts --check-only

  # Run a review and show results
  ANTHROPIC_API_KEY=sk-... npx tsx src/ai-review/cli.ts --verbose

  # Force review even if no changes
  ANTHROPIC_API_KEY=sk-... npx tsx src/ai-review/cli.ts --force

  # Run and save report
  ANTHROPIC_API_KEY=sk-... npx tsx src/ai-review/cli.ts --save

  # List previous reports
  npx tsx src/ai-review/cli.ts --list

  # Show a specific report
  npx tsx src/ai-review/cli.ts --show review-2024-01-15T10-30-00-000Z.json
`);
    process.exit(0);
  }

  const verbose = args.includes('--verbose');
  const save = args.includes('--save');
  const list = args.includes('--list');
  const checkOnly = args.includes('--check-only');
  const force = args.includes('--force');

  // Parse output directory
  let outputDir = '.reqon-data/ai-reviews';
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputDir = resolve(args[outputIndex + 1]);
  }

  // Parse model
  let model: string | undefined;
  const modelIndex = args.indexOf('--model');
  if (modelIndex !== -1 && args[modelIndex + 1]) {
    model = args[modelIndex + 1];
  }

  // Parse format
  let format: 'console' | 'json' | 'markdown' = 'console';
  const formatIndex = args.indexOf('--format');
  if (formatIndex !== -1 && args[formatIndex + 1]) {
    const fmt = args[formatIndex + 1];
    if (fmt === 'console' || fmt === 'json' || fmt === 'markdown') {
      format = fmt;
    }
  }

  // Handle --show
  const showIndex = args.indexOf('--show');
  if (showIndex !== -1 && args[showIndex + 1]) {
    const reporter = new ReviewReporter({ outputDir, verbose });
    try {
      const report = await reporter.loadReport(args[showIndex + 1]);
      if (format === 'json') {
        console.log(JSON.stringify(report.result, null, 2));
      } else if (format === 'markdown') {
        console.log(reporter.formatMarkdown(report.result));
      } else {
        console.log(reporter.formatConsoleOutput(report.result));
      }
    } catch (error) {
      console.error(`Error loading report: ${(error as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Handle --list
  if (list) {
    const reporter = new ReviewReporter({ outputDir, verbose });
    const reports = await reporter.listReports();
    if (reports.length === 0) {
      console.log('No previous reports found.');
    } else {
      console.log('Previous reports:');
      for (const report of reports) {
        console.log(`  ${report}`);
      }
    }
    return;
  }

  // For check-only, we don't need API key
  if (checkOnly) {
    const config: AIReviewConfig = {
      outputDir,
      verbose,
      apiKey: 'not-needed-for-check', // Won't be used
    };

    try {
      // Create analyzer without API key validation for check-only
      const { VagueDocFetcher } = await import('./doc-fetcher.js');
      const { ReviewStateStore } = await import('./state.js');

      const docFetcher = new VagueDocFetcher({
        token: process.env.GITHUB_TOKEN,
        verbose,
      });
      const stateStore = new ReviewStateStore(`${outputDir}/state.json`);

      const lastReviewedCommit = await stateStore.getLastReviewedCommit();
      const currentCommit = await docFetcher.getLatestCommitSha();
      const hasChanges = lastReviewedCommit === null || currentCommit !== lastReviewedCommit;

      if (format === 'json') {
        console.log(JSON.stringify({
          hasChanges,
          currentCommit,
          lastReviewedCommit,
        }, null, 2));
      } else {
        console.log(`Current Vague commit:      ${currentCommit}`);
        console.log(`Last reviewed commit:      ${lastReviewedCommit ?? 'none'}`);
        console.log(`Changes since last review: ${hasChanges ? 'YES' : 'NO'}`);
      }

      process.exit(hasChanges ? 1 : 0);
    } catch (error) {
      console.error(`Error checking for changes: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Check for API key (required for full review)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    console.error('Set it with: export ANTHROPIC_API_KEY=your-key');
    console.error('(Use --check-only to check for changes without an API key)');
    process.exit(1);
  }

  // Run the review
  const config: AIReviewConfig = {
    outputDir,
    model,
    verbose,
  };

  try {
    const analyzer = new DocumentationAnalyzer(config);
    const reporter = new ReviewReporter({ outputDir, verbose });

    // Check for changes first (unless --force)
    if (!force) {
      console.log('Checking for changes in Vague...');
      const changeCheck = await analyzer.checkForChanges();

      if (!changeCheck.hasChanges) {
        console.log(`\n✓ No changes detected in Vague since last review.`);
        console.log(`  Last reviewed commit: ${changeCheck.lastReviewedCommit}`);
        console.log(`  Current commit: ${changeCheck.currentCommit}`);
        console.log('\nUse --force to run review anyway.');
        process.exit(3); // Exit code 3 = skipped
      }

      console.log(`Changes detected (${changeCheck.lastReviewedCommit?.slice(0, 7) ?? 'none'} → ${changeCheck.currentCommit.slice(0, 7)})`);
    }

    console.log('\nStarting AI documentation review...');
    console.log('This may take a minute...\n');

    const report = await analyzer.review(process.cwd());

    // Output based on format
    if (format === 'json') {
      console.log(JSON.stringify(report.result, null, 2));
    } else if (format === 'markdown') {
      console.log(reporter.formatMarkdown(report.result));
    } else {
      console.log(reporter.formatConsoleOutput(report.result));
    }

    // Save if requested
    if (save) {
      const filepath = await reporter.saveReport(report);
      console.log(`\nReport saved to: ${filepath}`);
    }

    // Exit with appropriate code
    if (report.result.changesNeeded) {
      const criticalCount = report.result.findings.filter(
        (f) => f.severity === 'critical'
      ).length;
      if (criticalCount > 0) {
        process.exit(2); // Critical findings
      }
      process.exit(1); // Changes needed but not critical
    }
    process.exit(0); // All good
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    if (verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
