import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionExecutor } from './executor.js';
import type {
  ReqonProgram,
  MissionDefinition,
  ActionDefinition,
  SourceDefinition,
  StoreDefinition,
  PipelineDefinition,
} from '../ast/nodes.js';

describe('MissionExecutor', () => {
  describe('basic validation', () => {
    it('returns error when no mission found in program', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('No mission found in program');
    });

    it('tracks execution duration', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('executes mission with empty pipeline', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'EmptyMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.actionsRun).toHaveLength(0);
    });
  });

  describe('mission selection', () => {
    it('executes first mission when no name specified', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'FirstMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
          {
            type: 'MissionDefinition',
            name: 'SecondMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
    });

    it('executes named mission when specified', async () => {
      const executor = new MissionExecutor({ dryRun: true, missionName: 'SecondMission' });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'FirstMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
          {
            type: 'MissionDefinition',
            name: 'SecondMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
    });

    it('falls back to first mission when named mission not found', async () => {
      // The executor falls back to the first mission if named mission is not found
      const executor = new MissionExecutor({ dryRun: true, missionName: 'NonExistent' });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      // Falls back to first mission
      expect(result.success).toBe(true);
    });
  });

  describe('store initialization', () => {
    it('initializes memory stores', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [],
            stores: [
              {
                type: 'StoreDefinition',
                name: 'testStore',
                target: 'test_table',
                storeType: 'memory',
              } as StoreDefinition,
            ],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
      expect(result.stores.size).toBe(1);
      expect(result.stores.has('testStore')).toBe(true);
    });

    it('initializes file stores', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [],
            stores: [
              {
                type: 'StoreDefinition',
                name: 'fileStore',
                target: './test-data.json',
                storeType: 'file',
              } as StoreDefinition,
            ],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
      expect(result.stores.has('fileStore')).toBe(true);
    });
  });

  describe('pipeline execution', () => {
    it('reports action not found in pipeline', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [], // No actions defined
            pipeline: {
              type: 'PipelineDefinition',
              stages: [{ action: 'nonExistentAction' }],
            } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nonExistentAction'))).toBe(true);
    });

    it('executes action with empty steps', async () => {
      const executor = new MissionExecutor({ dryRun: true });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [
              {
                type: 'ActionDefinition',
                name: 'emptyAction',
                steps: [],
              } as ActionDefinition,
            ],
            pipeline: {
              type: 'PipelineDefinition',
              stages: [{ action: 'emptyAction' }],
            } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
      expect(result.actionsRun).toContain('emptyAction');
    });
  });

  describe('flow-control directives (skip/retry/jump/queue)', () => {
    const lit = (value: unknown, dataType = 'string') =>
      ({ type: 'Literal', value, dataType }) as unknown as import('vague-lang').Expression;

    const match = (target: unknown, arms: unknown[]) =>
      ({ type: 'MatchStep', target, arms }) as unknown as ActionStep;

    const mission = (over: Partial<MissionDefinition>): ReqonProgram => ({
      type: 'ReqonProgram',
      statements: [
        {
          type: 'MissionDefinition',
          name: 'FlowMission',
          sources: [],
          stores: [],
          schemas: [],
          transforms: [],
          actions: [],
          pipeline: { type: 'PipelineDefinition', stages: [] },
          ...over,
        } as MissionDefinition,
      ],
    });

    it('skip stops the remaining steps of an action without failing', async () => {
      const program = mission({
        actions: [
          {
            type: 'ActionDefinition',
            name: 'A',
            steps: [
              match(lit(1, 'number'), [{ schema: '_', flow: { type: 'skip' } }]),
              // This would abort the mission if it ever ran.
              match(lit(1, 'number'), [
                { schema: '_', flow: { type: 'abort', message: 'should not reach' } },
              ]),
            ],
          } as unknown as ActionDefinition,
        ],
        pipeline: {
          type: 'PipelineDefinition',
          stages: [{ action: 'A' }],
        } as PipelineDefinition,
      });

      const result = await new MissionExecutor({ dryRun: true }).execute(program);

      expect(result.success).toBe(true);
      expect(result.actionsRun).toContain('A');
    });

    it('per-item skip continues the loop; queue stores the surviving items', async () => {
      const program = mission({
        stores: [
          {
            type: 'StoreDefinition',
            name: 'q',
            target: 'q',
            storeType: 'memory',
          } as StoreDefinition,
        ],
        actions: [
          {
            type: 'ActionDefinition',
            name: 'A',
            steps: [
              {
                type: 'ForStep',
                variable: 'item',
                collection: lit(
                  [
                    { id: 'a', skip: false },
                    { id: 'b', skip: true },
                    { id: 'c', skip: false },
                  ],
                  'array'
                ),
                steps: [
                  match({ type: 'Identifier', name: 'item' }, [
                    {
                      schema: '_',
                      guard: {
                        type: 'BinaryExpression',
                        operator: '==',
                        left: { type: 'QualifiedName', parts: ['skip'] },
                        right: { type: 'Literal', value: true, dataType: 'boolean' },
                      },
                      flow: { type: 'skip' },
                    },
                    { schema: '_', flow: { type: 'queue', target: 'q' } },
                  ]),
                ],
              },
            ],
          } as unknown as ActionDefinition,
        ],
        pipeline: {
          type: 'PipelineDefinition',
          stages: [{ action: 'A' }],
        } as PipelineDefinition,
      });

      const result = await new MissionExecutor({ dryRun: true }).execute(program);

      expect(result.success).toBe(true);
      const q = result.stores.get('q')!;
      const rows = await q.list();
      expect(rows.map((r) => r.id).sort()).toEqual(['a', 'c']);
    });

    it('retry re-runs the action and exhausts cleanly instead of crashing', async () => {
      const program = mission({
        actions: [
          {
            type: 'ActionDefinition',
            name: 'A',
            steps: [
              match(lit(1, 'number'), [
                {
                  schema: '_',
                  flow: {
                    type: 'retry',
                    backoff: { maxAttempts: 2, backoff: 'constant', initialDelay: 0 },
                  },
                },
              ]),
            ],
          } as unknown as ActionDefinition,
        ],
        pipeline: {
          type: 'PipelineDefinition',
          stages: [{ action: 'A' }],
        } as PipelineDefinition,
      });

      const result = await new MissionExecutor({ dryRun: true }).execute(program);

      // Always-retrying arm exhausts its attempts; the failure is a clean
      // "exhausted retry attempts" error, not an uncaught RetrySignal.
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => /retry attempt/i.test(e.message))).toBe(true);
    });

    it('jump redirects the pipeline to the target action and skips intervening stages', async () => {
      const program = mission({
        stores: [
          {
            type: 'StoreDefinition',
            name: 'q',
            target: 'q',
            storeType: 'memory',
          } as StoreDefinition,
        ],
        actions: [
          {
            type: 'ActionDefinition',
            name: 'A',
            steps: [
              match(lit(1, 'number'), [{ schema: '_', flow: { type: 'jump', action: 'C' } }]),
            ],
          } as unknown as ActionDefinition,
          {
            type: 'ActionDefinition',
            name: 'B',
            steps: [
              match(lit(1, 'number'), [
                { schema: '_', flow: { type: 'abort', message: 'B should be skipped' } },
              ]),
            ],
          } as unknown as ActionDefinition,
          {
            type: 'ActionDefinition',
            name: 'C',
            steps: [
              match(lit({ marker: true }, 'object'), [
                { schema: '_', flow: { type: 'queue', target: 'q' } },
              ]),
            ],
          } as unknown as ActionDefinition,
        ],
        pipeline: {
          type: 'PipelineDefinition',
          stages: [{ action: 'A' }, { action: 'B' }, { action: 'C' }],
        } as PipelineDefinition,
      });

      const result = await new MissionExecutor({ dryRun: true }).execute(program);

      expect(result.success).toBe(true);
      expect(result.actionsRun).toContain('C');
      expect(result.actionsRun).not.toContain('B');
      expect(await result.stores.get('q')!.count()).toBe(1);
    });
  });

  describe('dry run mode', () => {
    it('executes in dry run mode without actual HTTP calls', async () => {
      const executor = new MissionExecutor({ dryRun: true, verbose: false });
      const program: ReqonProgram = {
        type: 'ReqonProgram',
        statements: [
          {
            type: 'MissionDefinition',
            name: 'TestMission',
            sources: [
              {
                type: 'SourceDefinition',
                name: 'api',
                config: { base: 'https://api.example.com' },
              } as SourceDefinition,
            ],
            stores: [],
            schemas: [],
            transforms: [],
            actions: [],
            pipeline: { type: 'PipelineDefinition', stages: [] } as PipelineDefinition,
          } as MissionDefinition,
        ],
      };

      const result = await executor.execute(program);

      expect(result.success).toBe(true);
    });
  });
});
