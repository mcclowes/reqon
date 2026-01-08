/**
 * Control Server Types
 *
 * Types for the HTTP control server that enables
 * pause/resume and live status queries.
 */

import type { ExecutionState, LiveProgress } from '../execution/index.js';

/**
 * Configuration for the control server
 */
export interface ControlServerConfig {
  /** Port to listen on (default: 3001) */
  port?: number;
  /** Host to bind to (default: localhost) */
  host?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Callbacks for control server events
 */
export interface ControlServerCallbacks {
  /** Called when pause is requested */
  onPauseRequested?: () => void;
  /** Called when resume is requested */
  onResumeRequested?: () => void;
  /** Called when status is queried */
  onStatusQueried?: () => void;
}

/**
 * Response for status endpoint
 */
export interface StatusResponse {
  /** Execution state (if available) */
  execution?: ExecutionState;
  /** Live progress (if available) */
  progress?: LiveProgress;
  /** Whether pause has been requested */
  pauseRequested: boolean;
  /** Server uptime in milliseconds */
  uptime: number;
  /** Timestamp of this response */
  timestamp: string;
}

/**
 * Response for pause/resume endpoints
 */
export interface ControlResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** Optional message */
  message?: string;
  /** Whether pause is currently requested */
  pauseRequested: boolean;
}
