import { join } from 'node:path';
import type { ExecutionState } from './state.js';
import {
  ensureDirectory,
  writeJsonFile,
  readJsonFile,
  listFiles,
  deleteFile,
  restoreDates,
  restoreDatesInArray,
} from '../utils/file.js';

/**
 * Execution state store interface
 */
export interface ExecutionStore {
  /** Save execution state */
  save(state: ExecutionState): Promise<void>;

  /** Load execution state by ID */
  load(id: string): Promise<ExecutionState | null>;

  /** List all executions for a mission */
  listByMission(mission: string): Promise<ExecutionState[]>;

  /** List recent executions */
  listRecent(limit?: number): Promise<ExecutionState[]>;

  /** Delete execution state */
  delete(id: string): Promise<void>;

  /** Find the latest execution for a mission */
  findLatest(mission: string): Promise<ExecutionState | null>;

  /** Find resumable executions (failed/paused) */
  findResumable(mission: string): Promise<ExecutionState[]>;
}

/**
 * File-based execution state store
 * Stores each execution as a JSON file in .reqon-data/executions/
 */
export class FileExecutionStore implements ExecutionStore {
  private baseDir: string;
  private initialized: Promise<void>;

  constructor(baseDir = '.reqon-data/executions') {
    this.baseDir = baseDir;
    this.initialized = ensureDirectory(this.baseDir);
  }

  private getFilePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  private deserialize(parsed: Record<string, unknown>): ExecutionState {
    // Restore Date objects
    restoreDates(parsed, ['startedAt', 'completedAt']);
    if (parsed.checkpoint && typeof parsed.checkpoint === 'object') {
      restoreDates(parsed.checkpoint as Record<string, unknown>, ['createdAt']);
    }
    restoreDatesInArray(
      parsed.stages as Record<string, unknown>[],
      ['startedAt', 'completedAt']
    );
    restoreDatesInArray(
      parsed.errors as Record<string, unknown>[],
      ['timestamp']
    );

    return parsed as unknown as ExecutionState;
  }

  async save(state: ExecutionState): Promise<void> {
    await this.initialized;
    const filePath = this.getFilePath(state.id);
    await writeJsonFile(filePath, state);
  }

  async load(id: string): Promise<ExecutionState | null> {
    await this.initialized;
    const filePath = this.getFilePath(id);
    const parsed = await readJsonFile<Record<string, unknown>>(filePath);
    return parsed ? this.deserialize(parsed) : null;
  }

  async listByMission(mission: string): Promise<ExecutionState[]> {
    const all = await this.listRecent();
    return all.filter((s) => s.mission === mission);
  }

  async listRecent(limit = 50): Promise<ExecutionState[]> {
    await this.initialized;

    const files = await listFiles(this.baseDir, '.json');
    const states: ExecutionState[] = [];

    for (const file of files) {
      const parsed = await readJsonFile<Record<string, unknown>>(file);
      if (parsed) {
        states.push(this.deserialize(parsed));
      }
    }

    // Sort by start time, newest first
    states.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    return states.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    await this.initialized;
    await deleteFile(this.getFilePath(id));
  }

  async findLatest(mission: string): Promise<ExecutionState | null> {
    const executions = await this.listByMission(mission);
    return executions[0] ?? null;
  }

  async findResumable(mission: string): Promise<ExecutionState[]> {
    const executions = await this.listByMission(mission);
    return executions.filter((e) => e.status === 'failed' || e.status === 'paused');
  }
}

/**
 * In-memory execution store (for testing)
 */
export class MemoryExecutionStore implements ExecutionStore {
  private states: Map<string, ExecutionState> = new Map();

  async save(state: ExecutionState): Promise<void> {
    // Deep clone to avoid reference issues
    this.states.set(state.id, JSON.parse(JSON.stringify(state)));
  }

  async load(id: string): Promise<ExecutionState | null> {
    const state = this.states.get(id);
    if (!state) return null;

    // Restore Date objects
    const restored = JSON.parse(JSON.stringify(state));
    restored.startedAt = new Date(restored.startedAt);
    if (restored.completedAt) {
      restored.completedAt = new Date(restored.completedAt);
    }

    return restored;
  }

  async listByMission(mission: string): Promise<ExecutionState[]> {
    const all = await this.listRecent();
    return all.filter((s) => s.mission === mission);
  }

  async listRecent(limit = 50): Promise<ExecutionState[]> {
    const states = Array.from(this.states.values()).map((s) => {
      const restored = JSON.parse(JSON.stringify(s));
      restored.startedAt = new Date(restored.startedAt);
      if (restored.completedAt) {
        restored.completedAt = new Date(restored.completedAt);
      }
      return restored as ExecutionState;
    });

    states.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return states.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.states.delete(id);
  }

  async findLatest(mission: string): Promise<ExecutionState | null> {
    const executions = await this.listByMission(mission);
    return executions[0] ?? null;
  }

  async findResumable(mission: string): Promise<ExecutionState[]> {
    const executions = await this.listByMission(mission);
    return executions.filter((e) => e.status === 'failed' || e.status === 'paused');
  }

  clear(): void {
    this.states.clear();
  }
}
