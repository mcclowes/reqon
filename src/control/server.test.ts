import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ControlServer } from './server.js';
import type { ExecutionState, LiveProgress } from '../execution/index.js';

describe('ControlServer', () => {
  let server: ControlServer;
  const TEST_PORT = 13001;

  beforeEach(() => {
    server = new ControlServer({ port: TEST_PORT, verbose: false });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('lifecycle', () => {
    it('starts and stops cleanly', async () => {
      expect(server.isRunning()).toBe(false);

      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('can start after stopping', async () => {
      await server.start();
      await server.stop();
      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('does not error if stopped when not running', async () => {
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('does not error if started when already running', async () => {
      await server.start();
      await expect(server.start()).resolves.not.toThrow();
    });
  });

  describe('pause/resume', () => {
    it('tracks pause request state', async () => {
      expect(server.isPauseRequested()).toBe(false);

      await server.start();

      // Request pause via HTTP
      const pauseRes = await fetch(`http://localhost:${TEST_PORT}/pause`, {
        method: 'POST',
      });
      expect(pauseRes.ok).toBe(true);
      expect(server.isPauseRequested()).toBe(true);

      // Clear pause request
      server.clearPauseRequest();
      expect(server.isPauseRequested()).toBe(false);
    });

    it('returns appropriate message when pause already requested', async () => {
      await server.start();

      // First pause - consume body to ensure connection closes cleanly
      const firstRes = await fetch(`http://localhost:${TEST_PORT}/pause`, {
        method: 'POST',
      });
      await firstRes.json();

      // Second pause
      const res = await fetch(`http://localhost:${TEST_PORT}/pause`, {
        method: 'POST',
      });
      const data = await res.json();
      expect(data.message).toContain('already');
    });

    it('clears pause via resume endpoint', async () => {
      await server.start();

      // Request pause
      await fetch(`http://localhost:${TEST_PORT}/pause`, { method: 'POST' });
      expect(server.isPauseRequested()).toBe(true);

      // Request resume
      const resumeRes = await fetch(`http://localhost:${TEST_PORT}/resume`, {
        method: 'POST',
      });
      expect(resumeRes.ok).toBe(true);
      expect(server.isPauseRequested()).toBe(false);
    });
  });

  describe('security', () => {
    it('rejects a cross-origin request with 403', async () => {
      await server.start();
      const res = await fetch(`http://localhost:${TEST_PORT}/pause`, {
        method: 'POST',
        headers: { Origin: 'http://evil.example.com' },
      });
      expect(res.status).toBe(403);
      expect(server.isPauseRequested()).toBe(false);
    });

    it('requires the shared secret on state-changing endpoints when configured', async () => {
      const secured = new ControlServer({ port: 13099, authToken: 's3cret' });
      try {
        await secured.start();

        const unauth = await fetch('http://localhost:13099/pause', { method: 'POST' });
        expect(unauth.status).toBe(401);
        expect(secured.isPauseRequested()).toBe(false);

        const authed = await fetch('http://localhost:13099/pause', {
          method: 'POST',
          headers: { Authorization: 'Bearer s3cret' },
        });
        expect(authed.ok).toBe(true);
        expect(secured.isPauseRequested()).toBe(true);
      } finally {
        await secured.stop();
      }
    });

    it('rejects a token of the wrong length without throwing', async () => {
      const secured = new ControlServer({ port: 13098, authToken: 's3cret' });
      try {
        await secured.start();
        const res = await fetch('http://localhost:13098/pause', {
          method: 'POST',
          headers: { Authorization: 'Bearer short' },
        });
        expect(res.status).toBe(401);
        expect(secured.isPauseRequested()).toBe(false);
      } finally {
        await secured.stop();
      }
    });

    it('refuses to start on a non-loopback host with no authToken', async () => {
      const exposed = new ControlServer({ port: 13097, host: '0.0.0.0' });
      await expect(exposed.start()).rejects.toThrow(/Refusing to start/);
      expect(exposed.isRunning()).toBe(false);
      await exposed.stop();
    });

    it('starts on a non-loopback host when an authToken is set', async () => {
      const exposed = new ControlServer({ port: 13096, host: '0.0.0.0', authToken: 's3cret' });
      try {
        await expect(exposed.start()).resolves.not.toThrow();
        expect(exposed.isRunning()).toBe(true);
      } finally {
        await exposed.stop();
      }
    });

    it('still starts on loopback with no authToken', async () => {
      const loopback = new ControlServer({ port: 13095, host: '127.0.0.1' });
      try {
        await expect(loopback.start()).resolves.not.toThrow();
        expect(loopback.isRunning()).toBe(true);
      } finally {
        await loopback.stop();
      }
    });
  });

  describe('status endpoint', () => {
    it('returns basic status when no execution state', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/status`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.pauseRequested).toBe(false);
      expect(data.uptime).toBeGreaterThanOrEqual(0);
      expect(data.timestamp).toBeDefined();
      expect(data.execution).toBeUndefined();
    });

    it('returns execution state when set', async () => {
      await server.start();

      const state: ExecutionState = {
        id: 'exec_test123',
        mission: 'TestMission',
        status: 'running',
        startedAt: new Date(),
        stages: [
          { action: 'Step1', status: 'completed', attempt: 0 },
          { action: 'Step2', status: 'running', attempt: 0 },
        ],
        errors: [],
      };
      server.updateState(state);

      const res = await fetch(`http://localhost:${TEST_PORT}/status`);
      const data = await res.json();

      expect(data.execution.id).toBe('exec_test123');
      expect(data.execution.status).toBe('running');
      expect(data.execution.stages).toHaveLength(2);
    });

    it('returns live progress when set', async () => {
      await server.start();

      const progress: LiveProgress = {
        currentStage: 1,
        currentAction: 'FetchData',
        currentStep: 'fetch',
        loopProgress: {
          current: 50,
          total: 100,
          variable: 'item',
        },
        lastHeartbeat: new Date(),
      };
      server.updateProgress(progress);

      const res = await fetch(`http://localhost:${TEST_PORT}/status`);
      const data = await res.json();

      expect(data.progress.currentStage).toBe(1);
      expect(data.progress.currentAction).toBe('FetchData');
      expect(data.progress.loopProgress.current).toBe(50);
    });
  });

  describe('health endpoint', () => {
    it('returns ok status', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('works with /_health path too', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/_health`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('ok');
    });
  });

  describe('callbacks', () => {
    it('calls onPauseRequested when pause is requested', async () => {
      let called = false;
      server = new ControlServer(
        { port: TEST_PORT },
        {
          onPauseRequested: () => {
            called = true;
          },
        }
      );
      await server.start();

      await fetch(`http://localhost:${TEST_PORT}/pause`, { method: 'POST' });
      expect(called).toBe(true);
    });

    it('calls onResumeRequested when resume is requested', async () => {
      let called = false;
      server = new ControlServer(
        { port: TEST_PORT },
        {
          onResumeRequested: () => {
            called = true;
          },
        }
      );
      await server.start();

      // Must pause first
      await fetch(`http://localhost:${TEST_PORT}/pause`, { method: 'POST' });
      await fetch(`http://localhost:${TEST_PORT}/resume`, { method: 'POST' });
      expect(called).toBe(true);
    });

    it('calls onStatusQueried when status is queried', async () => {
      let called = false;
      server = new ControlServer(
        { port: TEST_PORT },
        {
          onStatusQueried: () => {
            called = true;
          },
        }
      );
      await server.start();

      await fetch(`http://localhost:${TEST_PORT}/status`);
      expect(called).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns 404 for unknown paths', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/unknown`);
      expect(res.status).toBe(404);
    });

    it('handles CORS preflight requests', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/pause`, {
        method: 'OPTIONS',
      });
      expect(res.status).toBe(204);
    });
  });
});
