/**
 * CLI Debugger - Interactive readline-based debugger for terminal use
 */

import * as readline from 'node:readline';
import type { DebugCommand, DebugSnapshot, DebugLocation, DebugMode } from './controller.js';
import { BaseDebugController } from './controller.js';

export class CLIDebugger extends BaseDebugController {
  private rl: readline.Interface;
  private closed = false;

  constructor() {
    super();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async pause(snapshot: DebugSnapshot): Promise<DebugCommand> {
    if (this.closed) {
      return { type: 'abort' };
    }

    this.printSnapshot(snapshot);
    return this.promptCommand();
  }

  private printSnapshot(s: DebugSnapshot): void {
    console.log('');
    console.log(`─── Debug: ${s.action} step ${s.stepIndex} (${s.stepType}) ───`);

    // Print pause reason
    if (s.pauseReason.type === 'loop-iteration') {
      console.log(`  Loop: ${s.pauseReason.variable} [${s.pauseReason.index + 1}/${s.pauseReason.total}]`);
    } else if (s.pauseReason.type === 'match-arm') {
      console.log(`  Matched: ${s.pauseReason.schema}`);
    } else if (s.pauseReason.type === 'breakpoint') {
      console.log(`  Breakpoint: ${s.pauseReason.location}`);
    }

    // Print variables summary
    const varKeys = Object.keys(s.variables);
    if (varKeys.length > 0) {
      const preview = varKeys.slice(0, 3).map(k => `${k}: ${this.formatValue(s.variables[k])}`).join(', ');
      const more = varKeys.length > 3 ? ` (+${varKeys.length - 3} more)` : '';
      console.log(`  Variables: { ${preview}${more} }`);
    }

    // Print stores summary
    const storeEntries = Object.entries(s.stores);
    if (storeEntries.length > 0) {
      const storeInfo = storeEntries.map(([name, info]) => {
        const count = info.count >= 0 ? ` (${info.count} items)` : '';
        return `${name}: ${info.type}${count}`;
      }).join(', ');
      console.log(`  Stores: { ${storeInfo} }`);
    }

    // Print response summary
    if (s.response !== undefined) {
      console.log(`  Response: ${this.formatValue(s.response)}`);
    }

    console.log('');
  }

  private formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return `[Array] (${value.length} items)`;
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      return `{Object} (${keys.length} keys)`;
    }
    if (typeof value === 'string') {
      return value.length > 30 ? `"${value.slice(0, 30)}..."` : `"${value}"`;
    }
    return String(value);
  }

  private promptCommand(): Promise<DebugCommand> {
    return new Promise((resolve) => {
      const ask = () => {
        this.rl.question('debug> ', (input) => {
          const result = this.parseCommand(input.trim());
          if (result) {
            resolve(result);
          } else {
            ask(); // Invalid command, ask again
          }
        });
      };
      ask();
    });
  }

  private parseCommand(input: string): DebugCommand | null {
    const parts = input.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? '';

    switch (cmd) {
      case 'c':
      case 'continue':
        return { type: 'continue' };

      case 's':
      case 'step':
        return { type: 'step' };

      case 'si':
      case 'step-into':
        return { type: 'step-into' };

      case 'so':
      case 'step-over':
        return { type: 'step-over' };

      case 'q':
      case 'quit':
      case 'abort':
        return { type: 'abort' };

      case 'vars':
      case 'variables':
        console.log('Use "vars" during pause to see variables in snapshot output above.');
        return null;

      case 'stores':
        console.log('Use "stores" during pause to see stores in snapshot output above.');
        return null;

      case 'response':
        console.log('Use "response" during pause to see response in snapshot output above.');
        return null;

      case 'bp':
      case 'breakpoint':
        if (parts[1]) {
          if (parts[1].startsWith('-')) {
            this.removeBreakpoint(parts[1].slice(1));
            console.log(`Removed breakpoint: ${parts[1].slice(1)}`);
          } else {
            this.addBreakpoint(parts[1]);
            console.log(`Added breakpoint: ${parts[1]}`);
          }
        } else {
          if (this.breakpoints.size === 0) {
            console.log('No breakpoints set.');
          } else {
            console.log('Breakpoints:');
            for (const bp of this.breakpoints) {
              console.log(`  - ${bp}`);
            }
          }
        }
        return null;

      case 'help':
      case 'h':
      case '?':
        this.printHelp();
        return null;

      case '':
        // Empty input - repeat last command (default to step)
        return { type: 'step' };

      default:
        console.log(`Unknown command: ${cmd}. Type "help" for available commands.`);
        return null;
    }
  }

  private printHelp(): void {
    console.log(`
Debug Commands:
  c, continue     Continue execution until next breakpoint
  s, step         Execute next step and pause
  si, step-into   Pause inside loops and match arms
  so, step-over   Skip loop/match internals, pause at next step
  q, quit, abort  Stop execution

  bp <loc>        Add breakpoint (e.g., "bp FetchUsers:2" or "bp FetchUsers:*")
  bp -<loc>       Remove breakpoint
  bp              List all breakpoints

  help, h, ?      Show this help message
  <Enter>         Repeat last command (default: step)
`);
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.rl.close();
    }
  }
}
