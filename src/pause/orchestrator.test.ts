import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebhookServer } from '../webhook/index.js';
import { MemoryPauseStore } from './store.js';
import { PauseManager } from './manager.js';
import { PauseOrchestrator } from './orchestrator.js';
import type { PauseState, PauseCheckpoint } from './state.js';

const checkpoint: PauseCheckpoint = {
  stageIndex: 0,
  stepIndex: 1,
  action: 'Test',
  variables: {},
};

/** Poll until `condition` returns truthy (or time out). */
async function waitFor<T>(condition: () => T | Promise<T>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('PauseOrchestrator', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  const startServer = async (): Promise<WebhookServer> => {
    const server = new WebhookServer({ port: 0 });
    await server.start();
    cleanups.push(() => server.stop());
    return server;
  };

  const startOrchestrator = async (
    config: ConstructorParameters<typeof PauseOrchestrator>[0]
  ): Promise<PauseOrchestrator> => {
    const orchestrator = new PauseOrchestrator(config);
    await orchestrator.start();
    cleanups.push(() => orchestrator.stop());
    return orchestrator;
  };

  const post = (server: WebhookServer, path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${server.getPort()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('resumes an expired timeout pause via the poll', async () => {
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store });
    await creator.createPause({
      executionId: 'exec-timeout',
      mission: 'M',
      duration: 50,
      checkpoint,
    });

    const resumed: PauseState[] = [];
    await startOrchestrator({
      store,
      pollInterval: 25,
      resume: (pause) => {
        resumed.push(pause);
      },
    });

    await waitFor(() => resumed.length > 0);
    expect(resumed).toHaveLength(1);
    expect(resumed[0].executionId).toBe('exec-timeout');
    expect(resumed[0].resumedBy).toBe('timeout');
  });

  it('resumes an already-expired pause immediately on start, before any poll tick', async () => {
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store });
    await creator.createPause({
      executionId: 'exec-expired',
      mission: 'M',
      duration: 1, // expires immediately
      checkpoint,
    });
    await new Promise((r) => setTimeout(r, 5));

    const resumed: PauseState[] = [];
    // Poll interval far beyond the test timeout: only the startup sweep can fire.
    await startOrchestrator({
      store,
      pollInterval: 60 * 60 * 1000,
      resume: (pause) => {
        resumed.push(pause);
      },
    });

    expect(resumed).toHaveLength(1);
    expect(resumed[0].executionId).toBe('exec-expired');
  });

  it('routes a live webhook delivery into a resume with the payload', async () => {
    const server = await startServer();
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store, webhookServer: server });
    await creator.createPause({
      executionId: 'exec-hook',
      mission: 'M',
      duration: '1h',
      checkpoint,
      resumeTriggers: [{ type: 'webhook', path: '/approve' }],
    });

    const resumed: PauseState[] = [];
    await startOrchestrator({
      store,
      webhookServer: server,
      pollInterval: 60 * 60 * 1000,
      resume: (pause) => {
        resumed.push(pause);
      },
    });

    const response = await post(server, '/approve', { ok: true });
    expect(response.status).toBe(200);

    await waitFor(() => resumed.length > 0);
    expect(resumed).toHaveLength(1);
    expect(resumed[0].resumedBy).toBe('webhook');
    expect(resumed[0].webhookPayload).toEqual({ ok: true });
  });

  it('picks up a webhook delivered before the orchestrator started', async () => {
    const server = await startServer();
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store, webhookServer: server });
    await creator.createPause({
      executionId: 'exec-early',
      mission: 'M',
      duration: '1h',
      checkpoint,
      resumeTriggers: [{ type: 'webhook', path: '/early' }],
    });

    // Delivered while nothing is listening for resumes.
    expect((await post(server, '/early', { early: true })).status).toBe(200);

    const resumed: PauseState[] = [];
    await startOrchestrator({
      store,
      webhookServer: server,
      pollInterval: 60 * 60 * 1000,
      resume: (pause) => {
        resumed.push(pause);
      },
    });

    expect(resumed).toHaveLength(1);
    expect(resumed[0].webhookPayload).toEqual({ early: true });
  });

  it('re-registers a lost webhook registration on start (restart recovery)', async () => {
    // The pause was created in a "previous process": its registration lives in
    // that process's in-memory webhook store, which this fresh server lacks.
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store });
    await creator.createPause({
      executionId: 'exec-restart',
      mission: 'M',
      duration: '1h',
      checkpoint,
      resumeTriggers: [{ type: 'webhook', path: '/after-restart' }],
    });

    const server = await startServer();
    const resumed: PauseState[] = [];
    await startOrchestrator({
      store,
      webhookServer: server,
      pollInterval: 60 * 60 * 1000,
      resume: (pause) => {
        resumed.push(pause);
      },
    });

    // Without recovery this delivery would 404; with it, the path is live again
    // and the resume matches the trigger by path.
    const response = await post(server, '/after-restart', { retry: 1 });
    expect(response.status).toBe(200);

    await waitFor(() => resumed.length > 0);
    expect(resumed[0].executionId).toBe('exec-restart');
    expect(resumed[0].webhookPayload).toEqual({ retry: 1 });
  });

  it('reports a failing resume callback and keeps orchestrating', async () => {
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store });
    await creator.createPause({
      executionId: 'exec-fail',
      mission: 'M',
      duration: 1,
      checkpoint,
    });

    const errors: Array<{ error: Error; pause: PauseState }> = [];
    const resumed: PauseState[] = [];
    const orchestrator = await startOrchestrator({
      store,
      pollInterval: 25,
      resume: (pause) => {
        resumed.push(pause);
        if (pause.executionId === 'exec-fail') throw new Error('boom');
      },
      onResumeError: (error, pause) => {
        errors.push({ error, pause });
      },
    });

    await waitFor(() => errors.length > 0);
    expect(errors[0].error.message).toBe('boom');
    expect(errors[0].pause.executionId).toBe('exec-fail');

    // The monitor survives the failure: a later pause still resumes.
    await creator.createPause({
      executionId: 'exec-after-fail',
      mission: 'M',
      duration: 1,
      checkpoint,
    });
    await waitFor(() => resumed.some((p) => p.executionId === 'exec-after-fail'));
    expect(orchestrator.manager).toBeDefined();
  });

  it('resumes exactly once when a webhook and an expired timeout race', async () => {
    const server = await startServer();
    const store = new MemoryPauseStore();
    const creator = new PauseManager({ store, webhookServer: server });
    await creator.createPause({
      executionId: 'exec-race',
      mission: 'M',
      duration: 30, // expires almost immediately
      checkpoint,
      resumeTriggers: [{ type: 'webhook', path: '/race' }, { type: 'timeout' }],
    });

    const resume = vi.fn();
    await startOrchestrator({
      store,
      webhookServer: server,
      pollInterval: 10,
      resume,
    });
    await post(server, '/race', { race: true }).catch(() => undefined);

    await waitFor(() => resume.mock.calls.length > 0);
    // Give the losing trigger every chance to double-fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
