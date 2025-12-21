import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionExecutor } from './executor.js';
import type { ReqonProgram, MissionDefinition, ActionDefinition, SourceDefinition, StoreDefinition, PipelineDefinition } from '../ast/nodes.js';

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

