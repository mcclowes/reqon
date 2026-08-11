/**
 * Pause Module - Resource-free long pauses for Reqon
 *
 * Provides pause functionality that persists state and releases resources:
 * - PauseManager: Creates and manages pauses
 * - PauseStore: Persists pause state
 * - Resume triggers: timeout, webhook, manual
 */

// State types
export type { PauseState, PauseResumeTriggerState, PauseCheckpoint } from './state.js';

export {
  generatePauseId,
  parseDuration,
  formatDuration,
  createPauseState,
  isPauseExpired,
  getRemainingTime,
  getPauseSummary,
} from './state.js';

export type { PauseStore } from './store.js';
export { FilePauseStore, MemoryPauseStore } from './store.js';
export { LogBackedPauseStore } from './log-store.js';

// Manager
export type { PauseManagerConfig, CreatePauseOptions, PauseStatus } from './manager.js';
export { PauseManager, createPauseManager } from './manager.js';

// Orchestrator - routes webhook/timeout triggers into resumes
export type { PauseOrchestratorConfig } from './orchestrator.js';
export { PauseOrchestrator, createPauseOrchestrator } from './orchestrator.js';
