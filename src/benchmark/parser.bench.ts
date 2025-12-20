/**
 * Parser benchmarks
 */

import { ReqonLexer } from '../lexer/lexer.js';
import { ReqonParser } from '../parser/parser.js';
import { BenchmarkSuite } from './utils.js';
import {
  SIMPLE_DSL,
  MEDIUM_DSL,
  COMPLEX_DSL,
  EXPRESSION_HEAVY_DSL,
  MATCH_HEAVY_DSL,
  generateLargeDSL,
} from './fixtures.js';

// Pre-tokenize for parser-only benchmarks
function preTokenize(source: string) {
  const lexer = new ReqonLexer(source);
  return lexer.tokenize();
}

export async function runParserBenchmarks(): Promise<void> {
  const suite = new BenchmarkSuite('Parser');

  // Pre-tokenize all fixtures
  const simpleTokens = preTokenize(SIMPLE_DSL);
  const mediumTokens = preTokenize(MEDIUM_DSL);
  const complexTokens = preTokenize(COMPLEX_DSL);
  const expressionTokens = preTokenize(EXPRESSION_HEAVY_DSL);
  const matchTokens = preTokenize(MATCH_HEAVY_DSL);
  const large10Tokens = preTokenize(generateLargeDSL(10));
  const large50Tokens = preTokenize(generateLargeDSL(50));

  // Parser-only benchmarks (with pre-tokenized input)
  suite.addSync('simple-dsl', () => {
    const parser = new ReqonParser([...simpleTokens]);
    return parser.parse();
  });

  suite.addSync('medium-dsl', () => {
    const parser = new ReqonParser([...mediumTokens]);
    return parser.parse();
  });

  suite.addSync('complex-dsl', () => {
    const parser = new ReqonParser([...complexTokens]);
    return parser.parse();
  });

  suite.addSync('expression-heavy', () => {
    const parser = new ReqonParser([...expressionTokens]);
    return parser.parse();
  });

  suite.addSync('match-heavy', () => {
    const parser = new ReqonParser([...matchTokens]);
    return parser.parse();
  });

  suite.addSync('large-10-actions', () => {
    const parser = new ReqonParser([...large10Tokens]);
    return parser.parse();
  });

  suite.addSync('large-50-actions', () => {
    const parser = new ReqonParser([...large50Tokens]);
    return parser.parse();
  }, { iterations: 500 });

  suite.print();

  // Full pipeline benchmarks (lexer + parser)
  const pipelineSuite = new BenchmarkSuite('Lexer + Parser Pipeline');

  pipelineSuite.addSync('simple-full', () => {
    const lexer = new ReqonLexer(SIMPLE_DSL);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens);
    return parser.parse();
  });

  pipelineSuite.addSync('medium-full', () => {
    const lexer = new ReqonLexer(MEDIUM_DSL);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens);
    return parser.parse();
  });

  pipelineSuite.addSync('complex-full', () => {
    const lexer = new ReqonLexer(COMPLEX_DSL);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens);
    return parser.parse();
  });

  pipelineSuite.print();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runParserBenchmarks().catch(console.error);
}
