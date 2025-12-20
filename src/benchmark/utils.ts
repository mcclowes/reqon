/**
 * Benchmarking utilities for Reqon
 */

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
  samples: number[];
}

export interface BenchmarkOptions {
  iterations?: number;
  warmupIterations?: number;
  name?: string;
}

const DEFAULT_OPTIONS: Required<BenchmarkOptions> = {
  iterations: 1000,
  warmupIterations: 100,
  name: 'benchmark',
};

/**
 * High-resolution timer using process.hrtime.bigint()
 */
export function hrTimeMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

/**
 * Run a synchronous benchmark
 */
export function benchmarkSync<T>(
  fn: () => T,
  options: BenchmarkOptions = {}
): BenchmarkResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const samples: number[] = [];

  // Warmup phase
  for (let i = 0; i < opts.warmupIterations; i++) {
    fn();
  }

  // Measurement phase
  for (let i = 0; i < opts.iterations; i++) {
    const start = hrTimeMs();
    fn();
    const end = hrTimeMs();
    samples.push(end - start);
  }

  return calculateStats(opts.name, samples);
}

/**
 * Run an asynchronous benchmark
 */
export async function benchmarkAsync<T>(
  fn: () => Promise<T>,
  options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const samples: number[] = [];

  // Warmup phase
  for (let i = 0; i < opts.warmupIterations; i++) {
    await fn();
  }

  // Measurement phase
  for (let i = 0; i < opts.iterations; i++) {
    const start = hrTimeMs();
    await fn();
    const end = hrTimeMs();
    samples.push(end - start);
  }

  return calculateStats(opts.name, samples);
}

/**
 * Calculate statistics from samples
 */
function calculateStats(name: string, samples: number[]): BenchmarkResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((sum, s) => sum + s, 0);
  const avgMs = totalMs / samples.length;
  const minMs = sorted[0];
  const maxMs = sorted[sorted.length - 1];
  const opsPerSec = 1000 / avgMs;

  return {
    name,
    iterations: samples.length,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSec,
    samples,
  };
}

/**
 * Format a benchmark result for display
 */
export function formatResult(result: BenchmarkResult): string {
  const lines = [
    `┌─ ${result.name}`,
    `│  Iterations: ${result.iterations.toLocaleString()}`,
    `│  Total time: ${result.totalMs.toFixed(2)}ms`,
    `│  Avg time:   ${result.avgMs.toFixed(4)}ms`,
    `│  Min time:   ${result.minMs.toFixed(4)}ms`,
    `│  Max time:   ${result.maxMs.toFixed(4)}ms`,
    `│  Ops/sec:    ${result.opsPerSec.toFixed(2)}`,
    `└──────────────────────────────────`,
  ];
  return lines.join('\n');
}

/**
 * Format multiple benchmark results as a comparison table
 */
export function formatResultsTable(results: BenchmarkResult[]): string {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 10);
  const header = `| ${'Name'.padEnd(nameWidth)} | Ops/sec      | Avg (ms)   | Min (ms)   | Max (ms)   |`;
  const separator = `|${'-'.repeat(nameWidth + 2)}|--------------|------------|------------|------------|`;

  const rows = results.map((r) => {
    return `| ${r.name.padEnd(nameWidth)} | ${r.opsPerSec.toFixed(2).padStart(12)} | ${r.avgMs.toFixed(4).padStart(10)} | ${r.minMs.toFixed(4).padStart(10)} | ${r.maxMs.toFixed(4).padStart(10)} |`;
  });

  return [separator, header, separator, ...rows, separator].join('\n');
}

/**
 * Suite for grouping related benchmarks
 */
export class BenchmarkSuite {
  private results: BenchmarkResult[] = [];
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  addSync<T>(name: string, fn: () => T, options?: BenchmarkOptions): this {
    const result = benchmarkSync(fn, { ...options, name });
    this.results.push(result);
    return this;
  }

  async addAsync<T>(
    name: string,
    fn: () => Promise<T>,
    options?: BenchmarkOptions
  ): Promise<this> {
    const result = await benchmarkAsync(fn, { ...options, name });
    this.results.push(result);
    return this;
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  print(): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Benchmark Suite: ${this.name}`);
    console.log(`${'='.repeat(60)}\n`);
    console.log(formatResultsTable(this.results));
    console.log('');
  }

  toJSON(): object {
    return {
      name: this.name,
      timestamp: new Date().toISOString(),
      results: this.results.map((r) => ({
        name: r.name,
        iterations: r.iterations,
        totalMs: r.totalMs,
        avgMs: r.avgMs,
        minMs: r.minMs,
        maxMs: r.maxMs,
        opsPerSec: r.opsPerSec,
      })),
    };
  }
}

/**
 * Generate a string of specified size for testing
 */
export function generateString(sizeKb: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n';
  const targetLength = sizeKb * 1024;
  let result = '';
  while (result.length < targetLength) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate random data for store benchmarks
 */
export function generateRecords(count: number): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      id: `record-${i}`,
      name: `Test Record ${i}`,
      value: Math.random() * 1000,
      active: Math.random() > 0.5,
      tags: ['tag1', 'tag2', 'tag3'].slice(0, Math.floor(Math.random() * 3) + 1),
      nested: {
        field1: `nested-${i}`,
        field2: i * 2,
      },
    });
  }
  return records;
}
