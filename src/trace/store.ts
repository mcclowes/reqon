/**
 * Trace Store - Persistence for execution traces
 *
 * Stores complete execution traces for time-travel debugging,
 * enabling replay and step-by-step inspection of past runs.
 */

import { join } from 'node:path';
import type { ExecutionTrace, TraceSnapshot } from './state.js';
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
 * Trace store interface
 */
export interface TraceStore {
  /** Save a complete trace */
  save(trace: ExecutionTrace): Promise<void>;

  /** Append a snapshot to an existing trace */
  appendSnapshot(traceId: string, snapshot: TraceSnapshot): Promise<void>;

  /** Load a trace by ID */
  load(id: string): Promise<ExecutionTrace | null>;

  /** Load a specific snapshot from a trace */
  loadSnapshot(traceId: string, snapshotIndex: number): Promise<TraceSnapshot | null>;

  /** List all traces for a mission */
  listByMission(mission: string, limit?: number): Promise<ExecutionTrace[]>;

  /** List recent traces across all missions */
  listRecent(limit?: number): Promise<ExecutionTrace[]>;

  /** Delete a trace */
  delete(id: string): Promise<void>;

  /** Find the latest trace for a mission */
  findLatest(mission: string): Promise<ExecutionTrace | null>;

  /** Get trace metadata without loading all snapshots (for performance) */
  getMetadata(id: string): Promise<Omit<ExecutionTrace, 'snapshots'> | null>;
}

/**
 * File-based trace store
 * Stores traces in .reqon-data/traces/ with separate files for metadata and snapshots
 */
export class FileTraceStore implements TraceStore {
  private baseDir: string;
  private initialized: Promise<void>;

  constructor(baseDir = '.reqon-data/traces') {
    this.baseDir = baseDir;
    this.initialized = ensureDirectory(this.baseDir);
  }

  private getTraceDir(id: string): string {
    return join(this.baseDir, id);
  }

  private getMetadataPath(id: string): string {
    return join(this.getTraceDir(id), 'metadata.json');
  }

  private getSnapshotPath(id: string, index: number): string {
    return join(this.getTraceDir(id), `snapshot_${index.toString().padStart(6, '0')}.json`);
  }

  private async deserializeTrace(parsed: Record<string, unknown>): Promise<ExecutionTrace> {
    restoreDates(parsed, ['startedAt', 'completedAt']);
    if (parsed.snapshots && Array.isArray(parsed.snapshots)) {
      restoreDatesInArray(parsed.snapshots as Record<string, unknown>[], ['timestamp']);
    }
    return parsed as unknown as ExecutionTrace;
  }

  private deserializeSnapshot(parsed: Record<string, unknown>): TraceSnapshot {
    restoreDates(parsed, ['timestamp']);
    return parsed as unknown as TraceSnapshot;
  }

  async save(trace: ExecutionTrace): Promise<void> {
    await this.initialized;
    const traceDir = this.getTraceDir(trace.id);
    await ensureDirectory(traceDir);

    // Save metadata separately from snapshots for efficient listing
    const metadata: Omit<ExecutionTrace, 'snapshots'> & { snapshotCount: number } = {
      id: trace.id,
      mission: trace.mission,
      mode: trace.mode,
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      duration: trace.duration,
      success: trace.success,
      metadata: trace.metadata,
      snapshotCount: trace.snapshots.length,
    };
    await writeJsonFile(this.getMetadataPath(trace.id), metadata);

    // Save each snapshot separately for efficient random access
    for (let i = 0; i < trace.snapshots.length; i++) {
      await writeJsonFile(this.getSnapshotPath(trace.id, i), trace.snapshots[i]);
    }
  }

  async appendSnapshot(traceId: string, snapshot: TraceSnapshot): Promise<void> {
    await this.initialized;
    const traceDir = this.getTraceDir(traceId);
    await ensureDirectory(traceDir);

    // Load current metadata to get snapshot count
    const metadataPath = this.getMetadataPath(traceId);
    const metadata = await readJsonFile<Record<string, unknown>>(metadataPath);

    let snapshotCount = 0;
    if (metadata && typeof metadata.snapshotCount === 'number') {
      snapshotCount = metadata.snapshotCount;
    }

    // Save the new snapshot
    await writeJsonFile(this.getSnapshotPath(traceId, snapshotCount), snapshot);

    // Update metadata with new count
    if (metadata) {
      metadata.snapshotCount = snapshotCount + 1;
      await writeJsonFile(metadataPath, metadata);
    }
  }

  async load(id: string): Promise<ExecutionTrace | null> {
    await this.initialized;

    const metadata = await this.getMetadata(id);
    if (!metadata) return null;

    // Load all snapshots
    const snapshots: TraceSnapshot[] = [];
    const snapshotFiles = await listFiles(this.getTraceDir(id), '.json');

    for (const file of snapshotFiles) {
      if (file.includes('snapshot_')) {
        const parsed = await readJsonFile<Record<string, unknown>>(file);
        if (parsed) {
          snapshots.push(this.deserializeSnapshot(parsed));
        }
      }
    }

    // Sort by index
    snapshots.sort((a, b) => a.index - b.index);

    return {
      ...metadata,
      snapshots,
    };
  }

  async loadSnapshot(traceId: string, snapshotIndex: number): Promise<TraceSnapshot | null> {
    await this.initialized;
    const snapshotPath = this.getSnapshotPath(traceId, snapshotIndex);
    const parsed = await readJsonFile<Record<string, unknown>>(snapshotPath);
    return parsed ? this.deserializeSnapshot(parsed) : null;
  }

  async listByMission(mission: string, limit = 50): Promise<ExecutionTrace[]> {
    const all = await this.listRecent(limit * 2); // Load more to filter
    return all.filter((t) => t.mission === mission).slice(0, limit);
  }

  async listRecent(limit = 50): Promise<ExecutionTrace[]> {
    await this.initialized;

    const entries = await listFiles(this.baseDir, '');
    const traces: ExecutionTrace[] = [];

    // Read metadata files from subdirectories
    for (const entry of entries) {
      if (entry.endsWith('metadata.json')) {
        const parsed = await readJsonFile<Record<string, unknown>>(entry);
        if (parsed) {
          const trace = await this.deserializeTrace(parsed);
          // Return without snapshots for listing efficiency
          traces.push({ ...trace, snapshots: [] });
        }
      }
    }

    // Sort by start time, newest first
    traces.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    return traces.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    await this.initialized;
    const traceDir = this.getTraceDir(id);
    const files = await listFiles(traceDir, '.json');
    for (const file of files) {
      await deleteFile(file);
    }
    // Note: Directory cleanup would require additional fs.rmdir
  }

  async findLatest(mission: string): Promise<ExecutionTrace | null> {
    const traces = await this.listByMission(mission, 1);
    return traces[0] ?? null;
  }

  async getMetadata(id: string): Promise<Omit<ExecutionTrace, 'snapshots'> | null> {
    await this.initialized;
    const parsed = await readJsonFile<Record<string, unknown>>(this.getMetadataPath(id));
    if (!parsed) return null;

    restoreDates(parsed, ['startedAt', 'completedAt']);
    const { snapshotCount: _snapshotCount, ...rest } = parsed;
    return rest as unknown as Omit<ExecutionTrace, 'snapshots'>;
  }
}

/**
 * In-memory trace store (for testing)
 */
export class MemoryTraceStore implements TraceStore {
  private traces: Map<string, ExecutionTrace> = new Map();

  async save(trace: ExecutionTrace): Promise<void> {
    this.traces.set(trace.id, JSON.parse(JSON.stringify(trace)));
  }

  async appendSnapshot(traceId: string, snapshot: TraceSnapshot): Promise<void> {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.snapshots.push(JSON.parse(JSON.stringify(snapshot)));
    }
  }

  async load(id: string): Promise<ExecutionTrace | null> {
    const trace = this.traces.get(id);
    if (!trace) return null;

    const restored = JSON.parse(JSON.stringify(trace));
    restored.startedAt = new Date(restored.startedAt);
    if (restored.completedAt) {
      restored.completedAt = new Date(restored.completedAt);
    }
    for (const snapshot of restored.snapshots) {
      snapshot.timestamp = new Date(snapshot.timestamp);
    }
    return restored;
  }

  async loadSnapshot(traceId: string, snapshotIndex: number): Promise<TraceSnapshot | null> {
    const trace = this.traces.get(traceId);
    if (!trace || snapshotIndex >= trace.snapshots.length) return null;

    const snapshot = JSON.parse(JSON.stringify(trace.snapshots[snapshotIndex]));
    snapshot.timestamp = new Date(snapshot.timestamp);
    return snapshot;
  }

  async listByMission(mission: string, limit = 50): Promise<ExecutionTrace[]> {
    const all = await this.listRecent();
    return all.filter((t) => t.mission === mission).slice(0, limit);
  }

  async listRecent(limit = 50): Promise<ExecutionTrace[]> {
    const traces = Array.from(this.traces.values()).map((t) => {
      const restored = JSON.parse(JSON.stringify(t));
      restored.startedAt = new Date(restored.startedAt);
      if (restored.completedAt) {
        restored.completedAt = new Date(restored.completedAt);
      }
      return { ...restored, snapshots: [] } as ExecutionTrace;
    });

    traces.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return traces.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.traces.delete(id);
  }

  async findLatest(mission: string): Promise<ExecutionTrace | null> {
    const traces = await this.listByMission(mission, 1);
    return traces[0] ?? null;
  }

  async getMetadata(id: string): Promise<Omit<ExecutionTrace, 'snapshots'> | null> {
    const trace = await this.load(id);
    if (!trace) return null;
    const { snapshots: _snapshots, ...metadata } = trace;
    return metadata;
  }

  clear(): void {
    this.traces.clear();
  }
}
