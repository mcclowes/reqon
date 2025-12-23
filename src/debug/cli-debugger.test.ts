import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIDebugger } from './cli-debugger.js';
import type { DebugSnapshot } from './controller.js';

describe('CLIDebugger', () => {
  let debugger_: CLIDebugger;

  beforeEach(() => {
    debugger_ = new CLIDebugger();
  });

  afterEach(() => {
    debugger_.close();
  });

  describe('shouldPause', () => {
    it('inherits BaseDebugController behavior', () => {
      debugger_.mode = 'step';

      expect(debugger_.shouldPause({
        action: 'TestAction',
        stepIndex: 0,
        stepType: 'fetch',
      })).toBe(true);
    });

    it('respects breakpoints', () => {
      debugger_.mode = 'run';
      debugger_.addBreakpoint('FetchData:0');

      expect(debugger_.shouldPause({
        action: 'FetchData',
        stepIndex: 0,
        stepType: 'fetch',
      })).toBe(true);

      expect(debugger_.shouldPause({
        action: 'FetchData',
        stepIndex: 1,
        stepType: 'store',
      })).toBe(false);
    });
  });

  describe('breakpoints', () => {
    it('adds breakpoints via addBreakpoint', () => {
      debugger_.addBreakpoint('Action:5');
      expect(debugger_.breakpoints.has('Action:5')).toBe(true);
    });

    it('removes breakpoints via removeBreakpoint', () => {
      debugger_.addBreakpoint('Action:5');
      debugger_.removeBreakpoint('Action:5');
      expect(debugger_.breakpoints.has('Action:5')).toBe(false);
    });
  });

  describe('close', () => {
    it('can be called multiple times safely', () => {
      expect(() => {
        debugger_.close();
        debugger_.close();
      }).not.toThrow();
    });

    it('returns abort command after close', async () => {
      debugger_.close();

      const snapshot: DebugSnapshot = {
        mission: 'test',
        action: 'TestAction',
        stepIndex: 0,
        stepType: 'fetch',
        pauseReason: { type: 'step' },
        variables: {},
        stores: {},
        response: undefined,
      };

      const result = await debugger_.pause(snapshot);
      expect(result.type).toBe('abort');
    });
  });

  describe('mode', () => {
    it('starts in step mode', () => {
      expect(debugger_.mode).toBe('step');
    });

    it('can be set to different modes', () => {
      debugger_.mode = 'run';
      expect(debugger_.mode).toBe('run');

      debugger_.mode = 'step-into';
      expect(debugger_.mode).toBe('step-into');

      debugger_.mode = 'step-over';
      expect(debugger_.mode).toBe('step-over');
    });
  });
});
