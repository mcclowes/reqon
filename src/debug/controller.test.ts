import { describe, it, expect } from 'vitest';
import { BaseDebugController, type DebugLocation, type DebugSnapshot, type DebugCommand } from './controller.js';

/** Test implementation of BaseDebugController */
class TestDebugController extends BaseDebugController {
  public pauseCalls: DebugSnapshot[] = [];
  public commandToReturn: DebugCommand = { type: 'step' };

  async pause(snapshot: DebugSnapshot): Promise<DebugCommand> {
    this.pauseCalls.push(snapshot);
    return this.commandToReturn;
  }
}

describe('BaseDebugController', () => {
  describe('shouldPause', () => {
    it('pauses at exact breakpoint match', () => {
      const controller = new TestDebugController();
      controller.mode = 'run';
      controller.addBreakpoint('FetchUsers:2');

      const location: DebugLocation = {
        action: 'FetchUsers',
        stepIndex: 2,
        stepType: 'fetch',
      };

      expect(controller.shouldPause(location)).toBe(true);
    });

    it('pauses at wildcard breakpoint match', () => {
      const controller = new TestDebugController();
      controller.mode = 'run';
      controller.addBreakpoint('FetchUsers:*');

      const location: DebugLocation = {
        action: 'FetchUsers',
        stepIndex: 5,
        stepType: 'store',
      };

      expect(controller.shouldPause(location)).toBe(true);
    });

    it('does not pause in run mode without breakpoints', () => {
      const controller = new TestDebugController();
      controller.mode = 'run';

      const location: DebugLocation = {
        action: 'FetchUsers',
        stepIndex: 0,
        stepType: 'fetch',
      };

      expect(controller.shouldPause(location)).toBe(false);
    });

    it('pauses at every step in step mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'step';

      const location: DebugLocation = {
        action: 'FetchUsers',
        stepIndex: 0,
        stepType: 'fetch',
      };

      expect(controller.shouldPause(location)).toBe(true);
    });

    it('does not pause at loop iterations in step mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'step';

      const location: DebugLocation = {
        action: 'ProcessItems',
        stepIndex: -1,
        stepType: 'for-iteration',
        isLoopIteration: true,
        loopInfo: { variable: 'item', index: 0, total: 10 },
      };

      expect(controller.shouldPause(location)).toBe(false);
    });

    it('pauses at loop iterations in step-into mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'step-into';

      const location: DebugLocation = {
        action: 'ProcessItems',
        stepIndex: -1,
        stepType: 'for-iteration',
        isLoopIteration: true,
        loopInfo: { variable: 'item', index: 0, total: 10 },
      };

      expect(controller.shouldPause(location)).toBe(true);
    });

    it('pauses at match arms in step-into mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'step-into';

      const location: DebugLocation = {
        action: 'HandleResponse',
        stepIndex: -1,
        stepType: 'match-arm',
        isMatchArm: true,
        matchInfo: { schema: 'SuccessResponse' },
      };

      expect(controller.shouldPause(location)).toBe(true);
    });

    it('does not pause at loop iterations in step-over mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'step-over';

      const location: DebugLocation = {
        action: 'ProcessItems',
        stepIndex: -1,
        stepType: 'for-iteration',
        isLoopIteration: true,
        loopInfo: { variable: 'item', index: 0, total: 10 },
      };

      expect(controller.shouldPause(location)).toBe(false);
    });

    it('pauses at regular steps in step-over mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'step-over';

      const location: DebugLocation = {
        action: 'ProcessItems',
        stepIndex: 1,
        stepType: 'store',
      };

      expect(controller.shouldPause(location)).toBe(true);
    });
  });

  describe('breakpoints', () => {
    it('adds and removes breakpoints', () => {
      const controller = new TestDebugController();

      controller.addBreakpoint('Action1:0');
      controller.addBreakpoint('Action2:*');

      expect(controller.breakpoints.has('Action1:0')).toBe(true);
      expect(controller.breakpoints.has('Action2:*')).toBe(true);
      expect(controller.breakpoints.size).toBe(2);

      controller.removeBreakpoint('Action1:0');

      expect(controller.breakpoints.has('Action1:0')).toBe(false);
      expect(controller.breakpoints.size).toBe(1);
    });

    it('breakpoints take precedence over run mode', () => {
      const controller = new TestDebugController();
      controller.mode = 'run';
      controller.addBreakpoint('SpecificAction:3');

      // Should not pause at other locations
      expect(controller.shouldPause({
        action: 'OtherAction',
        stepIndex: 0,
        stepType: 'fetch',
      })).toBe(false);

      // Should pause at breakpoint
      expect(controller.shouldPause({
        action: 'SpecificAction',
        stepIndex: 3,
        stepType: 'map',
      })).toBe(true);
    });
  });

  describe('mode transitions', () => {
    it('starts in step mode by default', () => {
      const controller = new TestDebugController();
      expect(controller.mode).toBe('step');
    });

    it('allows mode changes', () => {
      const controller = new TestDebugController();

      controller.mode = 'run';
      expect(controller.mode).toBe('run');

      controller.mode = 'step-into';
      expect(controller.mode).toBe('step-into');

      controller.mode = 'step-over';
      expect(controller.mode).toBe('step-over');
    });
  });
});
