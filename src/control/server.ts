/**
 * Control Server
 *
 * HTTP server for runtime control of mission execution.
 * Provides pause/resume commands and live status queries.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import type { ExecutionState, LiveProgress } from '../execution/index.js';
import type {
  ControlServerConfig,
  ControlServerCallbacks,
  StatusResponse,
  ControlResponse,
} from './types.js';

const DEFAULTS = {
  PORT: 3001,
  HOST: 'localhost',
};

/**
 * Control Server
 *
 * Provides HTTP endpoints for controlling mission execution:
 * - POST /pause - Request graceful pause
 * - POST /resume - Clear pause request
 * - GET /status - Get current execution state and progress
 * - GET /health - Health check
 */
export class ControlServer {
  private config: Required<ControlServerConfig>;
  private callbacks: ControlServerCallbacks;
  private server?: Server;
  private running = false;
  private startTime = Date.now();

  // State managed by the control server
  private pauseRequested = false;
  private executionState?: ExecutionState;
  private liveProgress?: LiveProgress;

  constructor(config: ControlServerConfig = {}, callbacks: ControlServerCallbacks = {}) {
    this.config = {
      port: config.port ?? DEFAULTS.PORT,
      host: config.host ?? DEFAULTS.HOST,
      verbose: config.verbose ?? false,
    };
    this.callbacks = callbacks;
  }

  /**
   * Start the control server
   */
  async start(): Promise<void> {
    if (this.running) return;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.startTime = Date.now();
        this.log(`Control server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the control server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.running = false;
          this.log('Control server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if pause has been requested
   */
  isPauseRequested(): boolean {
    return this.pauseRequested;
  }

  /**
   * Clear pause request (called after pause is handled)
   */
  clearPauseRequest(): void {
    this.pauseRequested = false;
  }

  /**
   * Update execution state (called by executor)
   */
  updateState(state: ExecutionState): void {
    this.executionState = state;
  }

  /**
   * Update live progress (called by executor)
   */
  updateProgress(progress: LiveProgress): void {
    this.liveProgress = progress;
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = parseUrl(req.url ?? '/', true);
    const path = url.pathname ?? '/';
    const method = req.method ?? 'GET';

    // Set CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Route requests
      if (path === '/health' || path === '/_health') {
        this.handleHealth(res);
      } else if (path === '/status') {
        this.handleStatus(res);
      } else if (path === '/pause' && method === 'POST') {
        this.handlePause(res);
      } else if (path === '/resume' && method === 'POST') {
        this.handleResume(res);
      } else {
        this.sendJson(res, 404, { error: 'Not found', path });
      }
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /**
   * Handle health check
   */
  private handleHealth(res: ServerResponse): void {
    this.sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
    });
  }

  /**
   * Handle status query
   */
  private handleStatus(res: ServerResponse): void {
    this.callbacks.onStatusQueried?.();

    const response: StatusResponse = {
      execution: this.executionState,
      progress: this.liveProgress,
      pauseRequested: this.pauseRequested,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
    };

    this.sendJson(res, 200, response);
  }

  /**
   * Handle pause request
   */
  private handlePause(res: ServerResponse): void {
    if (this.pauseRequested) {
      const response: ControlResponse = {
        success: true,
        message: 'Pause already requested',
        pauseRequested: true,
      };
      this.sendJson(res, 200, response);
      return;
    }

    this.pauseRequested = true;
    this.callbacks.onPauseRequested?.();
    this.log('Pause requested');

    const response: ControlResponse = {
      success: true,
      message: 'Pause requested. Execution will pause at next safe point.',
      pauseRequested: true,
    };
    this.sendJson(res, 200, response);
  }

  /**
   * Handle resume request
   */
  private handleResume(res: ServerResponse): void {
    if (!this.pauseRequested) {
      const response: ControlResponse = {
        success: true,
        message: 'No pause was requested',
        pauseRequested: false,
      };
      this.sendJson(res, 200, response);
      return;
    }

    this.pauseRequested = false;
    this.callbacks.onResumeRequested?.();
    this.log('Pause request cleared');

    const response: ControlResponse = {
      success: true,
      message: 'Pause request cleared. Use --resume flag to resume execution.',
      pauseRequested: false,
    };
    this.sendJson(res, 200, response);
  }

  /**
   * Send JSON response
   */
  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Log message if verbose mode enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Control] ${message}`);
    }
  }
}
