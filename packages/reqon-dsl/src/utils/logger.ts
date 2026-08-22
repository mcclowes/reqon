/**
 * Logger interface for injectable logging
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Console-based logger implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private prefix?: string) {}

  private format(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(this.format(message), ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.log(this.format(message), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(this.format(message), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(this.format(message), ...args);
  }
}

/**
 * Silent logger that discards all messages
 */
export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Create a logger with optional prefix
 */
export function createLogger(prefix?: string, silent = false): Logger {
  return silent ? new SilentLogger() : new ConsoleLogger(prefix);
}
