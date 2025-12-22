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
  --help, -h          Show this help message

Environment Variables:
  ANTHROPIC_API_KEY   Required. Your Anthropic API key
  GITHUB_TOKEN        Optional. GitHub token for higher rate limits

Examples:
  # Run a review and show results
  ANTHROPIC_API_KEY=sk-... npx tsx src/ai-review/cli.ts --verbose

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

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    console.error('Set it with: export ANTHROPIC_API_KEY=your-key');
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

    console.log('Starting AI documentation review...');
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
