export interface SourceLocation {
  line: number;
  column: number;
  /** End column (optional, for ranges) */
  endColumn?: number;
}

export interface ErrorContext {
  /** The source code being parsed/executed */
  source?: string;
  /** File path if available */
  filePath?: string;
}

/**
 * Base class for Reqon errors with source location info
 */
export class ReqonError extends Error {
  readonly location: SourceLocation;
  readonly context?: ErrorContext;

  constructor(message: string, location: SourceLocation, context?: ErrorContext) {
    super(message);
    this.name = 'ReqonError';
    this.location = location;
    this.context = context;
  }

  /**
   * Format the error with source context for display
   */
  format(): string {
    const lines: string[] = [];

    // Header with location
    const fileInfo = this.context?.filePath ? `${this.context.filePath}:` : '';
    lines.push(`${this.name}: ${this.message}`);
    lines.push(`  --> ${fileInfo}${this.location.line}:${this.location.column}`);

    // Show source context if available
    if (this.context?.source) {
      const sourceLines = this.context.source.split('\n');
      const errorLine = sourceLines[this.location.line - 1];

      if (errorLine !== undefined) {
        const lineNum = this.location.line.toString();
        const padding = ' '.repeat(lineNum.length);

        lines.push(`${padding} |`);
        lines.push(`${lineNum} | ${errorLine}`);

        // Underline the error position
        const underlineStart = this.location.column - 1;
        const underlineLength = this.location.endColumn
          ? this.location.endColumn - this.location.column
          : 1;
        const underline = ' '.repeat(underlineStart) + '^'.repeat(Math.max(1, underlineLength));
        lines.push(`${padding} | ${underline}`);
      }
    }

    return lines.join('\n');
  }

  toString(): string {
    return this.format();
  }
}

/**
 * Error during lexical analysis
 */
export class LexerError extends ReqonError {
  constructor(message: string, location: SourceLocation, context?: ErrorContext) {
    super(message, location, context);
    this.name = 'LexerError';
  }
}

/**
 * Error during parsing
 */
export class ParseError extends ReqonError {
  /** The token value that caused the error */
  readonly tokenValue?: string;

  constructor(
    message: string,
    location: SourceLocation,
    context?: ErrorContext,
    tokenValue?: string
  ) {
    super(message, location, context);
    this.name = 'ParseError';
    this.tokenValue = tokenValue;
  }

  format(): string {
    const base = super.format();
    if (this.tokenValue) {
      return `${base}\n  found: '${this.tokenValue}'`;
    }
    return base;
  }
}

/**
 * Error during runtime evaluation
 */
export class RuntimeError extends ReqonError {
  /** The action/step where the error occurred */
  readonly action?: string;
  /** The step type (fetch, map, validate, etc.) */
  readonly stepType?: string;

  constructor(
    message: string,
    location: SourceLocation,
    context?: ErrorContext,
    options?: { action?: string; stepType?: string }
  ) {
    super(message, location, context);
    this.name = 'RuntimeError';
    this.action = options?.action;
    this.stepType = options?.stepType;
  }

  format(): string {
    const lines: string[] = [];

    // Header
    lines.push(`${this.name}: ${this.message}`);

    if (this.action) {
      lines.push(`  in action: ${this.action}`);
    }
    if (this.stepType) {
      lines.push(`  at step: ${this.stepType}`);
    }

    // Location
    const fileInfo = this.context?.filePath ? `${this.context.filePath}:` : '';
    lines.push(`  --> ${fileInfo}${this.location.line}:${this.location.column}`);

    // Source context
    if (this.context?.source) {
      const sourceLines = this.context.source.split('\n');
      const errorLine = sourceLines[this.location.line - 1];

      if (errorLine !== undefined) {
        const lineNum = this.location.line.toString();
        const padding = ' '.repeat(lineNum.length);

        lines.push(`${padding} |`);
        lines.push(`${lineNum} | ${errorLine}`);

        const underlineStart = this.location.column - 1;
        const underline = ' '.repeat(underlineStart) + '^';
        lines.push(`${padding} | ${underline}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Error during validation
 */
export class ValidationError extends ReqonError {
  readonly constraint?: string;
  readonly severity: 'error' | 'warning';

  constructor(
    message: string,
    location: SourceLocation,
    context?: ErrorContext,
    options?: { constraint?: string; severity?: 'error' | 'warning' }
  ) {
    super(message, location, context);
    this.name = 'ValidationError';
    this.constraint = options?.constraint;
    this.severity = options?.severity ?? 'error';
  }
}

/**
 * Format multiple errors for display
 */
export function formatErrors(errors: ReqonError[]): string {
  return errors.map(e => e.format()).join('\n\n');
}

/**
 * Get the source line at a given line number
 */
export function getSourceLine(source: string, lineNumber: number): string | undefined {
  const lines = source.split('\n');
  return lines[lineNumber - 1];
}

/**
 * Get surrounding context lines
 */
export function getSourceContext(
  source: string,
  lineNumber: number,
  contextLines: number = 2
): { lines: Array<{ num: number; text: string }>; errorLineIndex: number } {
  const allLines = source.split('\n');
  const start = Math.max(0, lineNumber - 1 - contextLines);
  const end = Math.min(allLines.length, lineNumber + contextLines);

  const lines: Array<{ num: number; text: string }> = [];
  for (let i = start; i < end; i++) {
    lines.push({ num: i + 1, text: allLines[i] });
  }

  return {
    lines,
    errorLineIndex: lineNumber - 1 - start,
  };
}
