import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionState } from './state.js';

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

  constructor(baseDir = '.reqon-data/executions') {
    this.baseDir = baseDir;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  private serialize(state: ExecutionState): string {
    return JSON.stringify(state, null, 2);
  }

  private deserialize(content: string): ExecutionState {
    const parsed = JSON.parse(content);

    // Restore Date objects
    parsed.startedAt = new Date(parsed.startedAt);
    if (parsed.completedAt) {
      parsed.completedAt = new Date(parsed.completedAt);
    }
    if (parsed.checkpoint?.createdAt) {
      parsed.checkpoint.createdAt = new Date(parsed.checkpoint.createdAt);
    }
    for (const stage of parsed.stages) {
      if (stage.startedAt) stage.startedAt = new Date(stage.startedAt);
      if (stage.completedAt) stage.completedAt = new Date(stage.completedAt);
    }
    for (const error of parsed.errors) {
      error.timestamp = new Date(error.timestamp);
    }

    return parsed as ExecutionState;
  }

  async save(state: ExecutionState): Promise<void> {
    const filePath = this.getFilePath(state.id);
    writeFileSync(filePath, this.serialize(state), 'utf-8');
  }

  async load(id: string): Promise<ExecutionState | null> {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return this.deserialize(content);
    } catch {
      return null;
    }
  }

  async listByMission(mission: string): Promise<ExecutionState[]> {
    const all = await this.listRecent();
    return all.filter((s) => s.mission === mission);
  }

  async listRecent(limit = 50): Promise<ExecutionState[]> {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const files = readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(this.baseDir, f));

    const states: ExecutionState[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        states.push(this.deserialize(content));
      } catch {
        // Skip corrupted files
      }
    }

    // Sort by start time, newest first
    states.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    return states.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getFilePath(id);
    if (existsSync(filePath)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(filePath);
    }
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
