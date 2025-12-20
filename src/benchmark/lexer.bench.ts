/**
 * Lexer benchmarks
 */

import { ReqonLexer } from '../lexer/lexer.js';
import { BenchmarkSuite } from './utils.js';
import {
  SIMPLE_DSL,
  MEDIUM_DSL,
  COMPLEX_DSL,
  EXPRESSION_HEAVY_DSL,
  generateLargeDSL,
} from './fixtures.js';

export async function runLexerBenchmarks(): Promise<void> {
  const suite = new BenchmarkSuite('Lexer');

  // Simple DSL tokenization
  suite.addSync('simple-dsl', () => {
    const lexer = new ReqonLexer(SIMPLE_DSL);
    return lexer.tokenize();
  });

  // Medium complexity DSL
  suite.addSync('medium-dsl', () => {
    const lexer = new ReqonLexer(MEDIUM_DSL);
    return lexer.tokenize();
  });

  // Complex DSL
  suite.addSync('complex-dsl', () => {
    const lexer = new ReqonLexer(COMPLEX_DSL);
    return lexer.tokenize();
  });

  // Expression-heavy DSL
  suite.addSync('expression-heavy', () => {
    const lexer = new ReqonLexer(EXPRESSION_HEAVY_DSL);
    return lexer.tokenize();
  });

  // Large generated DSL (10 actions)
  const largeDsl10 = generateLargeDSL(10);
  suite.addSync('large-10-actions', () => {
    const lexer = new ReqonLexer(largeDsl10);
    return lexer.tokenize();
  });

  // Large generated DSL (50 actions)
  const largeDsl50 = generateLargeDSL(50);
  suite.addSync('large-50-actions', () => {
    const lexer = new ReqonLexer(largeDsl50);
    return lexer.tokenize();
  }, { iterations: 500 });

  // Large generated DSL (100 actions) - stress test
  const largeDsl100 = generateLargeDSL(100);
  suite.addSync('large-100-actions', () => {
    const lexer = new ReqonLexer(largeDsl100);
    return lexer.tokenize();
  }, { iterations: 100, warmupIterations: 10 });

  suite.print();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runLexerBenchmarks().catch(console.error);
}
