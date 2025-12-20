/**
 * Benchmark suite for Reqon
 *
 * Run all benchmarks: npx tsx src/benchmark/index.ts
 * Run specific suite: npx tsx src/benchmark/index.ts --suite lexer
 */

import { runLexerBenchmarks } from './lexer.bench.js';
import { runParserBenchmarks } from './parser.bench.js';
import { runEvaluatorBenchmarks } from './evaluator.bench.js';
import { runStoreBenchmarks } from './store.bench.js';
import { runResilienceBenchmarks } from './resilience.bench.js';
import { runE2EBenchmarks } from './e2e.bench.js';

const SUITES: Record<string, () => Promise<void>> = {
  lexer: runLexerBenchmarks,
  parser: runParserBenchmarks,
  evaluator: runEvaluatorBenchmarks,
  store: runStoreBenchmarks,
  resilience: runResilienceBenchmarks,
  e2e: runE2EBenchmarks,
};

function printUsage(): void {
  console.log(`
Reqon Benchmark Suite
=====================

Usage:
  npx tsx src/benchmark/index.ts [options]

Options:
  --suite <name>    Run a specific benchmark suite
  --list            List available benchmark suites
  --help            Show this help message

Available Suites:
  lexer       - Tokenization benchmarks
  parser      - Parsing benchmarks
  evaluator   - Expression evaluation benchmarks
  store       - Store adapter benchmarks
  resilience  - Circuit breaker and rate limiter benchmarks
  e2e         - End-to-end execution benchmarks
  all         - Run all benchmarks (default)

Examples:
  npx tsx src/benchmark/index.ts              # Run all benchmarks
  npx tsx src/benchmark/index.ts --suite lexer   # Run only lexer benchmarks
  npx tsx src/benchmark/index.ts --suite parser  # Run only parser benchmarks
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let suiteName = 'all';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
    if (args[i] === '--list') {
      console.log('\nAvailable benchmark suites:');
      for (const name of Object.keys(SUITES)) {
        console.log(`  - ${name}`);
      }
      console.log('  - all (runs all suites)');
      process.exit(0);
    }
    if (args[i] === '--suite' || args[i] === '-s') {
      suiteName = args[++i];
    }
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   REQON BENCHMARK SUITE                       ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const startTime = Date.now();

  if (suiteName === 'all') {
    console.log('Running all benchmark suites...\n');
    for (const [name, runFn] of Object.entries(SUITES)) {
      console.log(`\n>>> Running ${name} benchmarks...`);
      await runFn();
    }
  } else if (SUITES[suiteName]) {
    console.log(`Running ${suiteName} benchmarks...\n`);
    await SUITES[suiteName]();
  } else {
    console.error(`Unknown suite: ${suiteName}`);
    console.error(`Available suites: ${Object.keys(SUITES).join(', ')}, all`);
    process.exit(1);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Benchmarks completed in ${totalTime}s`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
