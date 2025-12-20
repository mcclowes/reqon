import type { Expression } from 'vague-lang';
import type { ExecutionContext } from './context.js';
import { getVariable } from './context.js';

export function evaluate(expr: Expression, ctx: ExecutionContext, current?: unknown): unknown {
  switch (expr.type) {
    case 'Literal':
      return expr.value;

    case 'Identifier': {
      // Check if it's a field on current object
      if (current && typeof current === 'object' && current !== null) {
        const obj = current as Record<string, unknown>;
        if (expr.name in obj) {
          return obj[expr.name];
        }
      }
      // Check variables
      const value = getVariable(ctx, expr.name);
      if (value !== undefined) return value;
      // Special case: 'response' refers to ctx.response
      if (expr.name === 'response') {
        return ctx.response;
      }
      // Check if the identifier is a field on response
      if (ctx.response && typeof ctx.response === 'object') {
        const resp = ctx.response as Record<string, unknown>;
        if (expr.name in resp) return resp[expr.name];
      }
      return undefined;
    }

    case 'QualifiedName': {
      let value: unknown = current ?? ctx.response;

      for (const part of expr.parts) {
        if (value && typeof value === 'object' && value !== null) {
          value = (value as Record<string, unknown>)[part];
        } else {
          // Try from variables
          if (expr.parts.length > 0) {
            value = getVariable(ctx, expr.parts[0]);
            for (let i = 1; i < expr.parts.length; i++) {
              if (value && typeof value === 'object') {
                value = (value as Record<string, unknown>)[expr.parts[i]];
              } else {
                return undefined;
              }
            }
          }
          break;
        }
      }

      return value;
    }

    case 'BinaryExpression': {
      const left = evaluate(expr.left, ctx, current);
      const right = evaluate(expr.right, ctx, current);

      switch (expr.operator) {
        case '+':
          return (left as number) + (right as number);
        case '-':
          return (left as number) - (right as number);
        case '*':
          return (left as number) * (right as number);
        case '/':
          return (left as number) / (right as number);
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return (left as number) < (right as number);
        case '>':
          return (left as number) > (right as number);
        case '<=':
          return (left as number) <= (right as number);
        case '>=':
          return (left as number) >= (right as number);
        default:
          throw new Error(`Unknown operator: ${expr.operator}`);
      }
    }

    case 'LogicalExpression': {
      const left = evaluate(expr.left, ctx, current);

      if (expr.operator === 'and') {
        return left ? evaluate(expr.right, ctx, current) : false;
      } else {
        return left ? true : evaluate(expr.right, ctx, current);
      }
    }

    case 'NotExpression':
      return !evaluate(expr.operand, ctx, current);

    case 'UnaryExpression': {
      const operand = evaluate(expr.operand, ctx, current);
      if (expr.operator === '-') return -(operand as number);
      if (expr.operator === '+') return +(operand as number);
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
        const pattern = evaluate(arm.pattern, ctx, current);

        // Wildcard pattern
        if (arm.pattern.type === 'Identifier' && arm.pattern.name === '_') {
          return evaluate(arm.result, ctx, current);
        }

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
          return Array.isArray(args[0]) ? args[0].length : 0;
        case 'sum':
          return (args[0] as number[]).reduce((a, b) => a + b, 0);
        case 'count':
          return Array.isArray(args[0]) ? args[0].length : 0;
        case 'first':
          return Array.isArray(args[0]) ? args[0][0] : undefined;
        case 'last':
          return Array.isArray(args[0]) ? args[0][args[0].length - 1] : undefined;
        case 'round':
          return Math.round(args[0] as number);
        case 'floor':
          return Math.floor(args[0] as number);
        case 'ceil':
          return Math.ceil(args[0] as number);
        default:
          throw new Error(`Unknown function: ${expr.callee}`);
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

    default:
      throw new Error(`Cannot evaluate expression type: ${(expr as Expression).type}`);
  }
}

export function evaluateToString(expr: Expression, ctx: ExecutionContext, current?: unknown): string {
  const value = evaluate(expr, ctx, current);
  return String(value ?? '');
}

export function interpolatePath(path: string, ctx: ExecutionContext, current?: unknown): string {
  return path.replace(/\{([^}]+)\}/g, (_, expr) => {
    // Simple variable interpolation
    const parts = expr.split('.');
    let value: unknown = current;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = getVariable(ctx, part);
      }
    }

    return String(value ?? '');
  });
}
