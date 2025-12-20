/**
 * Evaluator benchmarks
 */

import type { Expression } from 'vague-lang';
import { evaluate, interpolatePath } from '../interpreter/evaluator.js';
import { createContext, setVariable } from '../interpreter/context.js';
import type { ExecutionContext } from '../interpreter/context.js';
import { BenchmarkSuite } from './utils.js';

// Create a rich test context
function createTestContext(): ExecutionContext {
  const ctx = createContext();

  // Set up variables
  setVariable(ctx, 'user', {
    id: '12345',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    age: 30,
    active: true,
    score: 85,
    tags: ['admin', 'premium', 'verified'],
    nested: {
      level1: {
        level2: {
          level3: {
            value: 42,
          },
        },
      },
    },
  });

  setVariable(ctx, 'items', [
    { id: 1, name: 'Item 1', price: 10 },
    { id: 2, name: 'Item 2', price: 20 },
    { id: 3, name: 'Item 3', price: 30 },
  ]);

  setVariable(ctx, 'a', 10);
  setVariable(ctx, 'b', 20);
  setVariable(ctx, 'c', 30);
  setVariable(ctx, 'x', 5);
  setVariable(ctx, 'y', 15);

  // Set up response
  ctx.response = {
    data: {
      users: [
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' },
      ],
      total: 100,
    },
    status: 'success',
  };

  return ctx;
}

// Expression factories
function literal(value: string | number | boolean): Expression {
  return { type: 'Literal', value };
}

function identifier(name: string): Expression {
  return { type: 'Identifier', name };
}

function qualifiedName(...parts: string[]): Expression {
  return { type: 'QualifiedName', parts };
}

function binary(left: Expression, operator: string, right: Expression): Expression {
  return { type: 'BinaryExpression', left, operator, right } as Expression;
}

function logical(left: Expression, operator: 'and' | 'or', right: Expression): Expression {
  return { type: 'LogicalExpression', left, operator, right } as Expression;
}

function call(callee: string, ...args: Expression[]): Expression {
  return { type: 'CallExpression', callee, arguments: args } as Expression;
}

function ternary(condition: Expression, consequent: Expression, alternate: Expression): Expression {
  return { type: 'TernaryExpression', condition, consequent, alternate } as Expression;
}

function matchExpr(value: Expression, arms: Array<{ pattern: Expression; result: Expression }>): Expression {
  return { type: 'MatchExpression', value, arms } as Expression;
}

export async function runEvaluatorBenchmarks(): Promise<void> {
  const suite = new BenchmarkSuite('Evaluator');
  const ctx = createTestContext();

  // Literal evaluation
  suite.addSync('literal-string', () => {
    return evaluate(literal('hello world'), ctx);
  });

  suite.addSync('literal-number', () => {
    return evaluate(literal(42), ctx);
  });

  // Identifier evaluation
  suite.addSync('identifier-simple', () => {
    return evaluate(identifier('a'), ctx);
  });

  suite.addSync('identifier-object', () => {
    return evaluate(identifier('user'), ctx);
  });

  // Qualified name (nested access)
  suite.addSync('qualified-2-levels', () => {
    return evaluate(qualifiedName('user', 'firstName'), ctx);
  });

  suite.addSync('qualified-4-levels', () => {
    return evaluate(qualifiedName('user', 'nested', 'level1', 'level2'), ctx);
  });

  suite.addSync('qualified-deep', () => {
    return evaluate(qualifiedName('user', 'nested', 'level1', 'level2', 'level3', 'value'), ctx);
  });

  // Arithmetic operations
  suite.addSync('arithmetic-add', () => {
    return evaluate(binary(identifier('a'), '+', identifier('b')), ctx);
  });

  suite.addSync('arithmetic-complex', () => {
    // (a + b) * (c - x) / (y + 1)
    const expr = binary(
      binary(
        binary(identifier('a'), '+', identifier('b')),
        '*',
        binary(identifier('c'), '-', identifier('x'))
      ),
      '/',
      binary(identifier('y'), '+', literal(1))
    );
    return evaluate(expr, ctx);
  });

  suite.addSync('arithmetic-deeply-nested', () => {
    // ((a + b) * (c + x)) + ((y - a) * (b - c))
    const expr = binary(
      binary(
        binary(identifier('a'), '+', identifier('b')),
        '*',
        binary(identifier('c'), '+', identifier('x'))
      ),
      '+',
      binary(
        binary(identifier('y'), '-', identifier('a')),
        '*',
        binary(identifier('b'), '-', identifier('c'))
      )
    );
    return evaluate(expr, ctx);
  });

  // Comparison operations
  suite.addSync('comparison-simple', () => {
    return evaluate(binary(identifier('a'), '<', identifier('b')), ctx);
  });

  suite.addSync('comparison-equality', () => {
    return evaluate(binary(qualifiedName('user', 'active'), '==', literal(true)), ctx);
  });

  // Logical operations
  suite.addSync('logical-and', () => {
    return evaluate(
      logical(
        binary(identifier('a'), '>', literal(5)),
        'and',
        binary(identifier('b'), '<', literal(30))
      ),
      ctx
    );
  });

  suite.addSync('logical-complex', () => {
    // (a > 5 and b < 30) or (c == 30 and x != 10)
    return evaluate(
      logical(
        logical(
          binary(identifier('a'), '>', literal(5)),
          'and',
          binary(identifier('b'), '<', literal(30))
        ),
        'or',
        logical(
          binary(identifier('c'), '==', literal(30)),
          'and',
          binary(identifier('x'), '!=', literal(10))
        )
      ),
      ctx
    );
  });

  // Function calls
  suite.addSync('call-length-array', () => {
    return evaluate(call('length', qualifiedName('user', 'tags')), ctx);
  });

  suite.addSync('call-sum', () => {
    return evaluate(call('sum', identifier('items')), ctx);
  });

  suite.addSync('call-first', () => {
    return evaluate(call('first', identifier('items')), ctx);
  });

  // Ternary expressions
  suite.addSync('ternary-simple', () => {
    return evaluate(
      ternary(
        binary(identifier('a'), '>', literal(5)),
        literal('yes'),
        literal('no')
      ),
      ctx
    );
  });

  suite.addSync('ternary-nested', () => {
    return evaluate(
      ternary(
        binary(identifier('a'), '>', literal(50)),
        literal('high'),
        ternary(
          binary(identifier('a'), '>', literal(20)),
          literal('medium'),
          literal('low')
        )
      ),
      ctx
    );
  });

  // Match expressions
  suite.addSync('match-3-arms', () => {
    return evaluate(
      matchExpr(qualifiedName('user', 'score'), [
        { pattern: literal(100), result: literal('perfect') },
        { pattern: literal(85), result: literal('good') },
        { pattern: identifier('_'), result: literal('other') },
      ]),
      ctx
    );
  });

  suite.addSync('match-6-arms', () => {
    return evaluate(
      matchExpr(identifier('a'), [
        { pattern: literal(1), result: literal('one') },
        { pattern: literal(2), result: literal('two') },
        { pattern: literal(5), result: literal('five') },
        { pattern: literal(10), result: literal('ten') },
        { pattern: literal(20), result: literal('twenty') },
        { pattern: identifier('_'), result: literal('other') },
      ]),
      ctx
    );
  });

  // Path interpolation
  suite.addSync('interpolate-simple', () => {
    return interpolatePath('/users/{user.id}', ctx);
  });

  suite.addSync('interpolate-multiple', () => {
    return interpolatePath('/users/{user.id}/orders/{a}/items/{b}', ctx);
  });

  suite.print();

  // Stress test suite
  const stressSuite = new BenchmarkSuite('Evaluator Stress Tests');

  // Many sequential evaluations
  stressSuite.addSync('100-sequential-evals', () => {
    let result: unknown;
    for (let i = 0; i < 100; i++) {
      result = evaluate(binary(identifier('a'), '+', literal(i)), ctx);
    }
    return result;
  }, { iterations: 100 });

  // Complex nested expression
  const deeplyNestedExpr = binary(
    binary(
      binary(
        binary(identifier('a'), '+', identifier('b')),
        '*',
        binary(identifier('c'), '-', identifier('x'))
      ),
      '/',
      binary(
        binary(identifier('y'), '+', literal(1)),
        '*',
        binary(identifier('a'), '-', literal(2))
      )
    ),
    '+',
    binary(
      binary(identifier('b'), '*', identifier('c')),
      '-',
      binary(identifier('x'), '/', binary(identifier('y'), '+', literal(1)))
    )
  );

  stressSuite.addSync('deeply-nested-expression', () => {
    return evaluate(deeplyNestedExpr, ctx);
  });

  stressSuite.print();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runEvaluatorBenchmarks().catch(console.error);
}
