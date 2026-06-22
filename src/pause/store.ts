/**
 * Pause Store - Persistence for pause states
 *
 * Stores pause state for resource-free long pauses,
 * enabling resumption after extended periods.
 */

import { safeJoin } from '../utils/path.js';
import type { PauseState } from './state.js';
import {
  ensureDirectory,
  writeJsonFile,
  readJsonFile,
  listFiles,
  deleteFile,
  restoreDates,
} from '../utils/file.js';

/**
 * Pause store interface
 */
export interface PauseStore {
  /** Save a pause state */
  save(pause: PauseState): Promise<void>;

  /** Load a pause by ID */
  load(id: string): Promise<PauseState | null>;

  /** Load pause by execution ID */
  loadByExecution(executionId: string): Promise<PauseState | null>;

  /** List all active (waiting) pauses */
  listActive(): Promise<PauseState[]>;

  /** List pauses for a mission */
  listByMission(mission: string): Promise<PauseState[]>;

  /** Delete a pause state */
  delete(id: string): Promise<void>;

  /** Find pauses that have expired but not yet processed */
  findExpired(): Promise<PauseState[]>;

  /** Update pause state (e.g., when resumed) */
  update(id: string, updates: Partial<PauseState>): Promise<void>;
}

/**
 * File-based pause store
 */
export class FilePauseStore implements PauseStore {
  private baseDir: string;
  private initialized: Promise<void>;

  constructor(baseDir = '.reqon-data/pauses') {
    this.baseDir = baseDir;
    this.initialized = ensureDirectory(this.baseDir);
  }

  private getFilePath(id: string): string {
    return safeJoin(this.baseDir, `${id}.json`);
  }

  private deserialize(parsed: Record<string, unknown>): PauseState {
    restoreDates(parsed, ['pausedAt', 'expiresAt', 'resumedAt']);
    return parsed as unknown as PauseState;
  }

  async save(pause: PauseState): Promise<void> {
    await this.initialized;
    await writeJsonFile(this.getFilePath(pause.id), pause);
  }

  async load(id: string): Promise<PauseState | null> {
    await this.initialized;
    const parsed = await readJsonFile<Record<string, unknown>>(this.getFilePath(id));
    return parsed ? this.deserialize(parsed) : null;
  }

  async loadByExecution(executionId: string): Promise<PauseState | null> {
    const all = await this.listActive();
    return all.find((p) => p.executionId === executionId) ?? null;
  }

  async listActive(): Promise<PauseState[]> {
    await this.initialized;
    const files = await listFiles(this.baseDir, '.json');
    const pauses: PauseState[] = [];

    for (const file of files) {
      const parsed = await readJsonFile<Record<string, unknown>>(file);
      if (parsed) {
        const pause = this.deserialize(parsed);
        if (pause.status === 'waiting') {
          pauses.push(pause);
        }
      }
    }

    return pauses.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }

  async listByMission(mission: string): Promise<PauseState[]> {
    await this.initialized;
    const files = await listFiles(this.baseDir, '.json');
    const pauses: PauseState[] = [];

    for (const file of files) {
      const parsed = await readJsonFile<Record<string, unknown>>(file);
      if (parsed) {
        const pause = this.deserialize(parsed);
        if (pause.mission === mission) {
          pauses.push(pause);
        }
      }
    }

    return pauses.sort((a, b) => b.pausedAt.getTime() - a.pausedAt.getTime());
  }

  async delete(id: string): Promise<void> {
    await this.initialized;
    await deleteFile(this.getFilePath(id));
  }

  async findExpired(): Promise<PauseState[]> {
    const active = await this.listActive();
    const now = new Date();
    return active.filter((p) => p.expiresAt <= now);
  }

  async update(id: string, updates: Partial<PauseState>): Promise<void> {
    const pause = await this.load(id);
    if (!pause) {
      throw new Error(`Pause not found: ${id}`);
    }

    const updated = { ...pause, ...updates };
    await this.save(updated);
  }
}

/**
 * In-memory pause store (for testing)
 */
export class MemoryPauseStore implements PauseStore {
  private pauses: Map<string, PauseState> = new Map();

  async save(pause: PauseState): Promise<void> {
    this.pauses.set(pause.id, JSON.parse(JSON.stringify(pause)));
  }

  async load(id: string): Promise<PauseState | null> {
    const pause = this.pauses.get(id);
    if (!pause) return null;

    const restored = JSON.parse(JSON.stringify(pause));
    restored.pausedAt = new Date(restored.pausedAt);
    restored.expiresAt = new Date(restored.expiresAt);
    if (restored.resumedAt) {
      restored.resumedAt = new Date(restored.resumedAt);
    }
    return restored;
  }

  async loadByExecution(executionId: string): Promise<PauseState | null> {
    for (const pause of this.pauses.values()) {
      if (pause.executionId === executionId && pause.status === 'waiting') {
        return this.load(pause.id);
      }
    }
    return null;
  }

  async listActive(): Promise<PauseState[]> {
    const pauses: PauseState[] = [];
    for (const pause of this.pauses.values()) {
      if (pause.status === 'waiting') {
        const loaded = await this.load(pause.id);
        if (loaded) pauses.push(loaded);
      }
    }
    return pauses.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }

  async listByMission(mission: string): Promise<PauseState[]> {
    const pauses: PauseState[] = [];
    for (const pause of this.pauses.values()) {
      if (pause.mission === mission) {
        const loaded = await this.load(pause.id);
        if (loaded) pauses.push(loaded);
      }
    }
    return pauses.sort((a, b) => b.pausedAt.getTime() - a.pausedAt.getTime());
  }

  async delete(id: string): Promise<void> {
    this.pauses.delete(id);
  }

  async findExpired(): Promise<PauseState[]> {
    const active = await this.listActive();
    const now = new Date();
    return active.filter((p) => p.expiresAt <= now);
  }

  async update(id: string, updates: Partial<PauseState>): Promise<void> {
    const pause = await this.load(id);
    if (!pause) {
      throw new Error(`Pause not found: ${id}`);
    }

    const updated = { ...pause, ...updates };
    await this.save(updated);
  }

  clear(): void {
    this.pauses.clear();
  }
}
