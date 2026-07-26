/**
 * ---
 * purpose: Expression evaluator - evaluates Vague/Reqon expressions at runtime
 * inputs:
 *   - Expression AST node (literals, identifiers, binary ops, function calls)
 *   - ExecutionContext with variables, response, stores
 *   - Optional current record for iteration contexts
 * outputs:
 *   - Evaluated value (any JSON-compatible type)
 * related:
 *   - ./context.ts - provides variable bindings
 *   - ./executor.ts - calls evaluate() for step expressions
 *   - ../parser/expressions.ts - IsExpression, ObjectLiteralExpression types
 * ---
 */

import type { Expression } from 'vague-lang';
import type { ExecutionContext } from './context.js';
import { getVariable } from './context.js';
import type {
  IsExpression,
  ObjectLiteralExpression,
  NullishExpression,
  IndexExpression,
} from '../parser/expressions.js';
import { isRecord } from '../utils/type-guards.js';
import { EvaluatorError, UnsupportedOperationError } from '../errors/index.js';

/**
 * Hard cap on the number of items range() will materialise. High enough for a
 * full FPL manager sweep (~12M), low enough to fail loudly rather than OOM on a
 * fat-fingered bound like range(1, 1e12).
 */
const RANGE_MAX = 20_000_000;

/**
 * Evaluate a Reqon/Vague expression within an execution context.
 *
 * Supports all expression types from the Vague DSL including literals, identifiers,
 * binary/logical/ternary expressions, function calls, and pattern matching.
 *
 * @param expr - The expression AST node to evaluate
 * @param ctx - The execution context containing variables, response data, and stores
 * @param current - Optional current record for iteration contexts (e.g., inside for/map)
 * @returns The evaluated result, which can be any JSON-compatible value
 *
 * @example
 * // Evaluate a simple identifier
 * const result = evaluate({ type: 'Identifier', name: 'foo' }, ctx);
 *
 * @example
 * // Evaluate with current record context
 * const result = evaluate(expr, ctx, { id: 1, name: 'test' });
 */
export function evaluate(
  expr: Expression | IsExpression | ObjectLiteralExpression | NullishExpression | IndexExpression,
  ctx: ExecutionContext,
  current?: unknown
): unknown {
  // Handle IsExpression before the switch (custom Reqon type, not in vague-lang Expression union)
  if (expr.type === 'IsExpression') {
    const isExpr = expr as IsExpression;
    const value = evaluate(isExpr.operand, ctx, current);
    return checkType(value, isExpr.typeCheck);
  }

  // Nullish coalescing (custom Reqon type). Short-circuits: only null/undefined
  // on the left falls through to the right operand, unlike `or`'s falsy check.
  if (expr.type === 'NullishExpression') {
    const nullishExpr = expr as NullishExpression;
    const left = evaluate(nullishExpr.left, ctx, current);
    return left === null || left === undefined ? evaluate(nullishExpr.right, ctx, current) : left;
  }

  // Subscript access (custom Reqon type): obj[key] / arr[index].
  if (expr.type === 'IndexExpression') {
    const indexExpr = expr as IndexExpression;
    const object = evaluate(indexExpr.object, ctx, current);
    const index = evaluate(indexExpr.index, ctx, current);
    if (Array.isArray(object)) {
      const i = typeof index === 'number' ? index : Number(index);
      if (!Number.isInteger(i)) return undefined;
      // Support negative indices (from the end), matching common expectations.
      return object[i < 0 ? object.length + i : i];
    }
    if (isRecord(object)) {
      return object[String(index)];
    }
    if (typeof object === 'string') {
      const i = typeof index === 'number' ? index : Number(index);
      if (!Number.isInteger(i)) return undefined;
      return object[i < 0 ? object.length + i : i];
    }
    return undefined;
  }

  // Handle ObjectLiteral before the switch (custom Reqon type)
  if (expr.type === 'ObjectLiteral') {
    const objExpr = expr as ObjectLiteralExpression;
    const result: Record<string, unknown> = {};
    for (const prop of objExpr.properties) {
      if (prop.spread) {
        // Merge the source object's own enumerable properties. Non-objects
        // (null/undefined from a missing field) contribute nothing.
        const source = evaluate(prop.value, ctx, current);
        if (isRecord(source)) {
          Object.assign(result, source);
        }
      } else {
        result[prop.key] = evaluate(prop.value, ctx, current);
      }
    }
    return result;
  }

  switch (expr.type) {
    case 'Literal':
      return expr.value;

    case 'Identifier': {
      // Check if it's a field on current object
      if (isRecord(current) && expr.name in current) {
        return current[expr.name];
      }
      // Check variables
      const value = getVariable(ctx, expr.name);
      if (value !== undefined) return value;
      // Special case: 'response' refers to ctx.response
      if (expr.name === 'response') {
        return ctx.response;
      }
      // Check if the identifier is a field on response
      if (isRecord(ctx.response) && expr.name in ctx.response) {
        return ctx.response[expr.name];
      }
      return undefined;
    }

    case 'QualifiedName': {
      // Handle 'response.x.y' specially - start from ctx.response
      if (expr.parts.length > 0 && expr.parts[0] === 'response') {
        let value: unknown = ctx.response;
        for (let i = 1; i < expr.parts.length; i++) {
          if (isRecord(value)) {
            value = value[expr.parts[i]];
          } else {
            return undefined;
          }
        }
        return value;
      }

      // Try from current/response first (common case for .field paths)
      let value: unknown = current ?? ctx.response;
      if (isRecord(value)) {
        let found = true;
        for (const part of expr.parts) {
          if (isRecord(value)) {
            value = value[part];
          } else {
            found = false;
            break;
          }
        }
        if (found && value !== undefined) {
          return value;
        }
      }

      // Fall back: try from variables (first part is variable name)
      if (expr.parts.length > 0) {
        value = getVariable(ctx, expr.parts[0]);
        if (value !== undefined) {
          for (let i = 1; i < expr.parts.length; i++) {
            if (isRecord(value)) {
              value = value[expr.parts[i]];
            } else {
              return undefined;
            }
          }
          return value;
        }
      }

      return undefined;
    }

    case 'BinaryExpression': {
      const left = evaluate(expr.left, ctx, current);
      const right = evaluate(expr.right, ctx, current);

      switch (expr.operator) {
        case '+':
          // Allow string concatenation
          if (typeof left === 'string' || typeof right === 'string') {
            return String(left ?? '') + String(right ?? '');
          }
          return toNumber(left, '+') + toNumber(right, '+');
        case '-':
          return toNumber(left, '-') - toNumber(right, '-');
        case '*':
          return toNumber(left, '*') * toNumber(right, '*');
        case '/': {
          const divisor = toNumber(right, '/');
          if (divisor === 0) {
            throw new EvaluatorError('Division by zero', { expression: '/' });
          }
          return toNumber(left, '/') / divisor;
        }
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return compareNumbers(left, right, '<');
        case '>':
          return compareNumbers(left, right, '>');
        case '<=':
          return compareNumbers(left, right, '<=');
        case '>=':
          return compareNumbers(left, right, '>=');
        case 'in': {
          // Membership: element in collection. Arrays test by value, strings
          // test substring, objects test own-key presence.
          if (Array.isArray(right)) return right.includes(left);
          if (typeof right === 'string') {
            return typeof left === 'string' && right.includes(left);
          }
          if (isRecord(right)) return String(left) in right;
          return false;
        }
        default:
          throw new UnsupportedOperationError(`operator: ${expr.operator}`, 'binary expression');
      }
    }

    case 'LogicalExpression': {
      const left = evaluate(expr.left, ctx, current);

      // Return operand values (like JS &&/||), not coerced booleans, so
      // idioms like `x or default` work. Short-circuit: only evaluate the
      // right operand when the left doesn't already decide the result.
      if (expr.operator === 'and') {
        return left ? evaluate(expr.right, ctx, current) : left;
      } else {
        return left ? left : evaluate(expr.right, ctx, current);
      }
    }

    case 'NotExpression':
      return !evaluate(expr.operand, ctx, current);

    case 'UnaryExpression': {
      const operand = evaluate(expr.operand, ctx, current);
      if (expr.operator === '-') return -toNumber(operand, 'unary -');
      if (expr.operator === '+') return toNumber(operand, 'unary +');
      return operand;
    }

    case 'TernaryExpression': {
      const condition = evaluate(expr.condition, ctx, current);
      return condition
        ? evaluate(expr.consequent, ctx, current)
        : evaluate(expr.alternate, ctx, current);
    }

    case 'MatchExpression': {
      const value = evaluate(expr.value, ctx, current);

      for (const arm of expr.arms) {
        const guard = (arm as { guard?: Expression }).guard;

        // Guarded arm: a plain identifier pattern binds the matched value into
        // scope (e.g. `s where s > 800`); `_` is a pure guard. The arm is taken
        // only when the guard holds. Unguarded arms below keep literal-equality
        // and wildcard semantics unchanged.
        if (guard) {
          let guardScope: unknown = current;
          if (arm.pattern.type === 'Identifier' && arm.pattern.name !== '_') {
            guardScope = isRecord(current)
              ? { ...current, [arm.pattern.name]: value }
              : { [arm.pattern.name]: value };
          }
          if (evaluate(guard, ctx, guardScope)) {
            return evaluate(arm.result, ctx, guardScope);
          }
          continue;
        }

        // Wildcard pattern
        if (arm.pattern.type === 'Identifier' && arm.pattern.name === '_') {
          return evaluate(arm.result, ctx, current);
        }

        const pattern = evaluate(arm.pattern, ctx, current);
        if (value === pattern) {
          return evaluate(arm.result, ctx, current);
        }
      }

      return undefined;
    }

    case 'CallExpression': {
      const args = expr.arguments.map((arg) => evaluate(arg, ctx, current));

      // Built-in functions
      switch (expr.callee) {
        case 'length':
          if (Array.isArray(args[0])) return args[0].length;
          if (typeof args[0] === 'string') return args[0].length;
          return 0;
        case 'sum': {
          if (!Array.isArray(args[0])) {
            throw new EvaluatorError('sum() requires an array argument', { expression: 'sum' });
          }
          return args[0].reduce((acc, val) => acc + toNumber(val, 'sum'), 0);
        }
        case 'count':
          return Array.isArray(args[0]) ? args[0].length : 0;
        case 'first':
          return Array.isArray(args[0]) ? args[0][0] : undefined;
        case 'last':
          return Array.isArray(args[0]) ? args[0][args[0].length - 1] : undefined;
        case 'range': {
          // range(end) -> [0, 1, ..., end-1]; range(start, end) -> [start, ..., end-1].
          // Materialises the whole array (the for-loop consumes an array), so a
          // hard cap guards against an accidental range that would exhaust memory.
          const hasStart = args.length > 1;
          const start = hasStart ? toNumber(args[0], 'range') : 0;
          const end = toNumber(hasStart ? args[1] : args[0], 'range');
          if (!Number.isFinite(start) || !Number.isFinite(end)) {
            throw new EvaluatorError('range() bounds must be finite numbers', {
              expression: 'range',
            });
          }
          const count = Math.max(0, Math.ceil(end - start));
          if (count > RANGE_MAX) {
            throw new EvaluatorError(
              `range() would produce ${count} items, over the ${RANGE_MAX} cap`,
              { expression: 'range' }
            );
          }
          const out = new Array<number>(count);
          for (let i = 0; i < count; i++) out[i] = start + i;
          return out;
        }
        case 'abs':
          return Math.abs(toNumber(args[0], 'abs'));
        case 'round':
          return Math.round(toNumber(args[0], 'round'));
        case 'floor':
          return Math.floor(toNumber(args[0], 'floor'));
        case 'ceil':
          return Math.ceil(toNumber(args[0], 'ceil'));
        case 'max':
        case 'min': {
          // Variadic numeric max/min: max(a, b, ...). A single array argument is
          // also accepted, so max([1, 2, 3]) works like max(1, 2, 3).
          const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          if (values.length === 0) {
            throw new EvaluatorError(`${expr.callee}() requires at least one argument`, {
              expression: expr.callee,
            });
          }
          const nums = values.map((v) => toNumber(v, expr.callee));
          return expr.callee === 'max' ? Math.max(...nums) : Math.min(...nums);
        }
        case 'concat': {
          // String concatenation of any number of arguments; null/undefined
          // render as empty string, matching evaluateToString's coercion.
          return args.map((v) => String(v ?? '')).join('');
        }
        case 'parseNumber': {
          // Coerce a value (typically a numeric string like "99.99") to a
          // number. Returns null when it can't be parsed, so a bad field drops
          // out rather than poisoning arithmetic with NaN.
          if (args[0] === null || args[0] === undefined) return null;
          const n = Number(args[0] as number);
          return Number.isNaN(n) ? null : n;
        }
        case 'fromUnix': {
          // Unix epoch seconds -> ISO-8601 string. Many APIs (Stripe, etc.)
          // return seconds; this normalises them to the same date format as
          // sources that already return ISO strings. Returns null if not finite.
          const secs = Number(args[0] as number);
          if (!Number.isFinite(secs)) return null;
          return new Date(secs * 1000).toISOString();
        }
        case 'now':
          return new Date().toISOString();
        case 'timestamp':
          // Epoch milliseconds, for arithmetic. Unlike now() (an ISO string),
          // timestamp() returns a number so `timestamp() - 86400000` (24h ago)
          // and other date math work.
          return Date.now();
        case 'env': {
          // The variable name must be a static string literal. A dynamic argument
          // (e.g. env(response.field)) would let fetched/untrusted data choose
          // which environment variable is read, exfiltrating secrets.
          const nameExpr = expr.arguments[0];
          if (!nameExpr || nameExpr.type !== 'Literal') {
            throw new EvaluatorError(
              `env() requires a string-literal variable name, not a dynamic expression`,
              { expression: 'env' }
            );
          }
          return process.env[String(args[0])] ?? '';
        }
        default:
          throw new UnsupportedOperationError(`function: ${expr.callee}`, 'call expression');
      }
    }

    case 'AnyOfExpression': {
      const collection = evaluate(expr.collection, ctx, current) as unknown[];
      if (!Array.isArray(collection)) return undefined;

      if (expr.condition) {
        return collection.find((item) => evaluate(expr.condition!, ctx, item));
      }

      return collection[Math.floor(Math.random() * collection.length)];
    }

    case 'OrderedSequenceType': {
      // Inline array literal: [1, 2, 3]
      const seqExpr = expr as unknown as { elements: Expression[] };
      return seqExpr.elements.map((el) => evaluate(el, ctx, current));
    }

    default:
      throw new EvaluatorError(`Cannot evaluate expression type: ${(expr as Expression).type}`, {
        expression: (expr as Expression).type,
      });
  }
}

/**
 * Evaluate an expression and convert the result to a string.
 *
 * @param expr - The expression to evaluate
 * @param ctx - The execution context
 * @param current - Optional current record for iteration contexts
 * @returns The string representation of the evaluated value
 */
export function evaluateToString(
  expr: Expression,
  ctx: ExecutionContext,
  current?: unknown
): string {
  const value = evaluate(expr, ctx, current);
  return String(value ?? '');
}

/**
 * Interpolate variables in a path string using {variable.path} syntax.
 *
 * Replaces placeholders like {id} or {user.name} with values from the
 * current record or execution context variables.
 *
 * @param path - The path string with {placeholder} syntax
 * @param ctx - The execution context
 * @param current - Optional current record for iteration contexts
 * @returns The interpolated path string
 *
 * @example
 * // Interpolate a simple variable
 * interpolatePath('/users/{id}', ctx, { id: 123 }); // '/users/123'
 *
 * @example
 * // Interpolate a nested path
 * interpolatePath('/orgs/{org.id}/users', ctx, { org: { id: 'acme' } }); // '/orgs/acme/users'
 */
export function interpolatePath(path: string, ctx: ExecutionContext, current?: unknown): string {
  return path.replace(/\{([^}]+)\}/g, (_, expr) => {
    // Resolve the root segment first, then walk the rest as pure member access
    // (matching QualifiedName evaluation). Resolving each segment independently
    // would, when `current` lacks the first segment, mis-resolve a later segment
    // as a standalone context variable — e.g. `{org.id}` looking up `id` instead
    // of falling back to the `org` variable and reading its `.id`.
    const [head, ...rest] = expr.split('.');
    let value: unknown =
      isRecord(current) && head in current ? current[head] : getVariable(ctx, head);

    for (const part of rest) {
      value = isRecord(value) ? value[part] : undefined;
    }

    // URL-encode each interpolated value so a path param can't inject path
    // segments, query strings, or fragments into the request target. Path params
    // are single segments, so encoding (which escapes '/', '?', '#', etc.) is the
    // correct treatment.
    return encodeURIComponent(String(value ?? ''));
  });
}

/**
 * Coerce a value to a number for arithmetic operations.
 * Returns NaN for values that cannot be meaningfully converted.
 */
function toNumber(value: unknown, operator: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value === null || value === undefined) {
    throw new EvaluatorError(
      `Cannot perform '${operator}' on ${value === null ? 'null' : 'undefined'}`,
      { expression: operator }
    );
  }
  throw new EvaluatorError(`Cannot perform '${operator}' on ${typeof value} (expected number)`, {
    expression: operator,
  });
}

/** Coerce for comparison, yielding NaN (not a throw) for nullish/non-numeric. */
function toComparable(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return Number(value);
  return NaN;
}

/**
 * Arithmetic comparison for `where`/`match`/`validate` guards. A missing or
 * non-numeric operand makes the comparison false (the record is excluded) rather
 * than throwing — real API data routinely omits fields, and one missing field
 * shouldn't abort the whole stage.
 */
function compareNumbers(left: unknown, right: unknown, operator: string): boolean {
  const leftNum = toComparable(left);
  const rightNum = toComparable(right);
  if (Number.isNaN(leftNum) || Number.isNaN(rightNum)) return false;

  switch (operator) {
    case '<':
      return leftNum < rightNum;
    case '>':
      return leftNum > rightNum;
    case '<=':
      return leftNum <= rightNum;
    case '>=':
      return leftNum >= rightNum;
    default:
      return false;
  }
}

/** Type check functions map - more efficient than switch statement */
const TYPE_CHECKERS: Map<string, (value: unknown) => boolean> = new Map([
  ['array', (v) => Array.isArray(v)],
  ['object', (v) => v !== null && typeof v === 'object' && !Array.isArray(v)],
  ['string', (v) => typeof v === 'string'],
  ['number', (v) => typeof v === 'number'],
  ['decimal', (v) => typeof v === 'number'],
  ['int', (v) => typeof v === 'number' && Number.isInteger(v)],
  ['integer', (v) => typeof v === 'number' && Number.isInteger(v)],
  ['boolean', (v) => typeof v === 'boolean'],
  ['null', (v) => v === null],
  ['undefined', (v) => v === undefined],
  ['date', (v) => v instanceof Date || (typeof v === 'string' && !isNaN(Date.parse(v)))],
]);

/**
 * Check if a value matches a type.
 * Supports: array, object, string, number, boolean, null, undefined, int, decimal, date
 */
function checkType(value: unknown, typeName: string): boolean {
  const checker = TYPE_CHECKERS.get(typeName.toLowerCase());
  if (!checker) {
    throw new UnsupportedOperationError(`type check: ${typeName}`, "'is' expression");
  }
  return checker(value);
}
