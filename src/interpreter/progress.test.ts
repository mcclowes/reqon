import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionExecutor } from './executor.js';
import type {
  ProgressCallbacks,
  ExecutionStartEvent,
  ExecutionCompleteEvent,
  StageStartEvent,
  StageCompleteEvent,
} from './executor.js';
import type { ReqonProgram, MissionDefinition } from '../ast/nodes.js';

function createTestProgram(stages: string[]): ReqonProgram {
  const actions = stages.map((name) => ({
    type: 'ActionDefinition' as const,
    name,
    steps: [],
  }));

  const pipeline = {
    type: 'PipelineDefinition' as const,
    stages: stages.map((action) => ({ action })),
  };

  const mission: MissionDefinition = {
    type: 'MissionDefinition',
    name: 'TestMission',
    sources: [],
    stores: [],
    schemas: [],
    transforms: [],
    actions,
    pipeline,
  };

  return {
    type: 'ReqonProgram',
    statements: [mission],
  };
}

describe('Progress Callbacks', () => {
  describe('onExecutionStart', () => {
    it('is called when execution begins', async () => {
      const onExecutionStart = vi.fn();
      const executor = new MissionExecutor({
        progress: { onExecutionStart },
      });

      await executor.execute(createTestProgram(['StepA', 'StepB']));

      expect(onExecutionStart).toHaveBeenCalledOnce();
      expect(onExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mission: 'TestMission',
          stageCount: 2,
          isResume: false,
        })
      );
    });

    it('includes executionId from ephemeral execution', async () => {
      const onExecutionStart = vi.fn();
      const executor = new MissionExecutor({
        progress: { onExecutionStart },
      });

      await executor.execute(createTestProgram(['StepA']));

      expect(onExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'ephemeral',
        })
      );
    });

    it('includes executionId when persistence enabled', async () => {
      const onExecutionStart = vi.fn();
      const executor = new MissionExecutor({
        persistState: true,
        dataDir: '.reqon-test-progress',
        progress: { onExecutionStart },
      });

      await executor.execute(createTestProgram(['StepA']));

      expect(onExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: expect.stringMatching(/^exec_/),
        })
      );
    });

    it('includes metadata if provided', async () => {
      const onExecutionStart = vi.fn();
      const executor = new MissionExecutor({
        metadata: { tenant: 'acme', userId: '123' },
        progress: { onExecutionStart },
      });

      await executor.execute(createTestProgram(['StepA']));

      expect(onExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { tenant: 'acme', userId: '123' },
        })
      );
    });
  });

  describe('onExecutionComplete', () => {
    it('is called when execution finishes successfully', async () => {
      const onExecutionComplete = vi.fn();
      const executor = new MissionExecutor({
        progress: { onExecutionComplete },
      });

      await executor.execute(createTestProgram(['StepA', 'StepB']));

      expect(onExecutionComplete).toHaveBeenCalledOnce();
      expect(onExecutionComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          mission: 'TestMission',
          success: true,
          stagesCompleted: 2,
          stagesFailed: 0,
          errors: [],
        })
      );
    });

    it('includes duration', async () => {
      const onExecutionComplete = vi.fn();
      const executor = new MissionExecutor({
        progress: { onExecutionComplete },
      });

      await executor.execute(createTestProgram(['StepA']));

      const event = onExecutionComplete.mock.calls[0][0] as ExecutionCompleteEvent;
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('onStageStart', () => {
    it('is called for each stage', async () => {
      const onStageStart = vi.fn();
      const executor = new MissionExecutor({
        progress: { onStageStart },
      });

      await executor.execute(createTestProgram(['StepA', 'StepB', 'StepC']));

      expect(onStageStart).toHaveBeenCalledTimes(3);
    });

    it('includes stage index and name', async () => {
      const events: StageStartEvent[] = [];
      const executor = new MissionExecutor({
        progress: {
          onStageStart: (e) => events.push(e),
        },
      });

      await executor.execute(createTestProgram(['Fetch', 'Process', 'Store']));

      expect(events[0]).toMatchObject({
        stageIndex: 0,
        stageName: 'Fetch',
        totalStages: 3,
      });
      expect(events[1]).toMatchObject({
        stageIndex: 1,
        stageName: 'Process',
        totalStages: 3,
      });
      expect(events[2]).toMatchObject({
        stageIndex: 2,
        stageName: 'Store',
        totalStages: 3,
      });
    });
  });

  describe('onStageComplete', () => {
    it('is called for each stage', async () => {
      const onStageComplete = vi.fn();
      const executor = new MissionExecutor({
        progress: { onStageComplete },
      });

      await executor.execute(createTestProgram(['StepA', 'StepB']));

      expect(onStageComplete).toHaveBeenCalledTimes(2);
    });

    it('includes success status and duration', async () => {
      const events: StageCompleteEvent[] = [];
      const executor = new MissionExecutor({
        progress: {
          onStageComplete: (e) => events.push(e),
        },
      });

      await executor.execute(createTestProgram(['StepA']));

      expect(events[0]).toMatchObject({
        stageIndex: 0,
        stageName: 'StepA',
        success: true,
      });
      expect(events[0].duration).toBeGreaterThanOrEqual(0);
      expect(events[0].error).toBeUndefined();
    });
  });

  describe('callback order', () => {
    it('fires callbacks in correct order', async () => {
      const callOrder: string[] = [];

      const executor = new MissionExecutor({
        progress: {
          onExecutionStart: () => callOrder.push('execStart'),
          onExecutionComplete: () => callOrder.push('execComplete'),
          onStageStart: (e) => callOrder.push(`stageStart:${e.stageName}`),
          onStageComplete: (e) => callOrder.push(`stageComplete:${e.stageName}`),
        },
      });

      await executor.execute(createTestProgram(['A', 'B']));

      expect(callOrder).toEqual([
        'execStart',
        'stageStart:A',
        'stageComplete:A',
        'stageStart:B',
        'stageComplete:B',
        'execComplete',
      ]);
    });
  });

  describe('real-time UI example', () => {
    it('can build a progress tracker', async () => {
      const progressLog: string[] = [];

      const executor = new MissionExecutor({
        progress: {
          onExecutionStart: (e) => {
            progressLog.push(`Starting ${e.mission} (${e.stageCount} stages)`);
          },
          onStageStart: (e) => {
            const pct = Math.round((e.stageIndex / e.totalStages) * 100);
            progressLog.push(`[${pct}%] Running ${e.stageName}...`);
          },
          onStageComplete: (e) => {
            const pct = Math.round(((e.stageIndex + 1) / e.totalStages) * 100);
            progressLog.push(`[${pct}%] ${e.stageName} ${e.success ? 'done' : 'failed'}`);
          },
          onExecutionComplete: (e) => {
            progressLog.push(`Finished: ${e.success ? 'SUCCESS' : 'FAILED'} in ${e.duration}ms`);
          },
        },
      });

      await executor.execute(createTestProgram(['Fetch', 'Process', 'Store']));

      expect(progressLog[0]).toBe('Starting TestMission (3 stages)');
      expect(progressLog[1]).toBe('[0%] Running Fetch...');
      expect(progressLog[2]).toBe('[33%] Fetch done');
      expect(progressLog[3]).toBe('[33%] Running Process...');
      expect(progressLog[4]).toBe('[67%] Process done');
      expect(progressLog[5]).toBe('[67%] Running Store...');
      expect(progressLog[6]).toBe('[100%] Store done');
      expect(progressLog[7]).toMatch(/^Finished: SUCCESS in \d+ms$/);
    });
  });
});
