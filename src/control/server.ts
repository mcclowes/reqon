/**
 * Control Server
 *
 * HTTP server for runtime control of mission execution.
 * Provides pause/resume commands and live status queries.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { safeEqual } from '../utils/crypto-safe.js';
import {
  redactExecutionState,
  type ExecutionState,
  type LiveProgress,
} from '../execution/index.js';
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
      authToken: config.authToken ?? '',
    };
    this.callbacks = callbacks;
  }

  /**
   * Start the control server
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Hard-refuse to expose a state-changing server beyond loopback without a
    // shared secret. /pause, /resume, and /status would otherwise be reachable
    // by anyone who can route to this host. Bind to loopback or set authToken.
    if (!this.isLoopback(this.config.host) && !this.config.authToken) {
      throw new Error(
        `[Control] Refusing to start: binding to non-loopback host "${this.config.host}" ` +
          `with no authToken would expose /pause, /resume, and /status without authentication. ` +
          `Set an authToken or bind to localhost.`
      );
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.setTimeout(30000);

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
    // WHATWG URL, not the deprecated url.parse() (DEP0169 warns it has security
    // implications for which CVEs are not issued). req.url is path-only, so it is
    // resolved against a dummy origin to extract the pathname.
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // No wildcard CORS. Same-origin reads only; we never reflect ACAO so a
    // browser on another origin can't read /status.
    res.setHeader('Vary', 'Origin');

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // CSRF defense: reject any request that carries a cross-origin Origin
    // header (server-to-server clients and curl send none). Combined with the
    // loopback bind, this stops a web page the operator visits from POSTing
    // /pause or /resume to their local control server.
    if (this.hasCrossOriginHeader(req)) {
      this.sendJson(res, 403, { error: 'Cross-origin request rejected' });
      return;
    }

    try {
      // Route requests
      if (path === '/health' || path === '/_health') {
        this.handleHealth(res);
      } else if (path === '/status') {
        if (!this.authorized(req, res)) return;
        this.handleStatus(res);
      } else if (path === '/pause' && method === 'POST') {
        if (!this.authorized(req, res)) return;
        this.handlePause(res);
      } else if (path === '/resume' && method === 'POST') {
        if (!this.authorized(req, res)) return;
        this.handleResume(res);
      } else {
        this.sendJson(res, 404, { error: 'Not found', path });
      }
    } catch (error) {
      this.sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /** True if a host string is a loopback address. */
  private isLoopback(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  /** True if the request carries an Origin header pointing at another origin. */
  private hasCrossOriginHeader(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin || typeof origin !== 'string') return false;
    const host = req.headers.host;
    try {
      const originHost = new URL(origin).host;
      return originHost !== host;
    } catch {
      // Unparseable Origin — treat as cross-origin (reject).
      return true;
    }
  }

  /**
   * Enforce the shared-secret token on protected endpoints. When no token is
   * configured, allow (the loopback bind + CSRF check are the baseline) but
   * warn so operators know /status state is exposed locally.
   */
  private authorized(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.config.authToken) {
      return true;
    }
    const header = req.headers.authorization;
    const expected = `Bearer ${this.config.authToken}`;
    if (typeof header !== 'string' || !safeEqual(header, expected)) {
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return false;
    }
    return true;
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
      // Redact at the serve boundary: error messages carry response-body
      // snippets, and metadata is caller-provided (#263).
      execution: this.executionState && redactExecutionState(this.executionState),
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
    // Close the connection after each response. This localhost admin server has
    // no need for keep-alive, and avoiding pooled sockets removes a client-side
    // socket-reuse race (intermittent ECONNRESET on rapid sequential requests).
    res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
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
