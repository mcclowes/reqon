import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWithResume } from '../index.js';
import { FileExecutionLog } from '../execution-log/index.js';
import { LogBackedPauseStore } from '../pause/index.js';
import { WebhookServer } from '../webhook/index.js';

/**
 * End-to-end pause resume (#197): the wiring between the webhook server, the
 * pause manager, and the executor. A mission pauses; a real webhook delivered
 * over HTTP (or an expired timeout noticed by the poll) resumes it; the
 * pipeline tail runs exactly once. Unit tests on the manager in isolation
 * can't catch this gap — these tests use real HTTP and real replay.
 */
describe('e2e: pause resumes from its triggers', () => {
  const dirs: string[] = [];
  const servers: WebhookServer[] = [];
  const freshDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'reqon-pause-e2e-'));
    dirs.push(d);
    return d;
  };
  afterEach(async () => {
    for (const s of servers) if (s.isRunning()) await s.stop();
    servers.length = 0;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  const webhookMission = `
    mission Approval {
      store approvals: memory("approvals")
      action AwaitApproval {
        pause {
          duration: "30d",
          resumeOn: webhook "/approved"
        }
        store response -> approvals
      }
      run AwaitApproval
    }
  `;

  it('an inbound webhook over real HTTP resumes the paused mission; the tail runs exactly once', async () => {
    const dir = join(freshDir(), 'log');
    const log = new FileExecutionLog(dir);
    const server = new WebhookServer({ port: 0 });
    servers.push(server);
    await server.start();

    const running = executeWithResume(webhookMission, {
      executionLog: log,
      webhookServer: server,
    });

    // Wait until the run has actually suspended on the pause.
    const store = new LogBackedPauseStore(log);
    const deadline = Date.now() + 5000;
    while ((await store.listActive()).length === 0) {
      if (Date.now() > deadline) throw new Error('mission never paused');
      await new Promise((r) => setTimeout(r, 20));
    }

    // The caller POSTs to the registered path — a real request over HTTP.
    // (The keyless store step falls back to the record's `id` as its key.)
    const payload = { id: 'approval-1', approved: true, by: 'reviewer-1' };
    const response = await fetch(`http://127.0.0.1:${server.getPort()}/approved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);

    const result = await running;
    expect(result.success).toBe(true);
    expect(result.pauseId).toBeUndefined();

    // The webhook payload flowed through the pause into the tail.
    const approvals = await result.stores.get('approvals')!.list();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject(payload);

    // Exactly once: one pause, one resume, one completion — no re-pause loop,
    // no duplicated tail.
    const types = (await log.read(result.executionId!)).map((e) => e.type);
    expect(types.filter((t) => t === 'pause.created')).toHaveLength(1);
    expect(types.filter((t) => t === 'pause.resumed')).toHaveLength(1);
    expect(types.filter((t) => t === 'mission.completed')).toHaveLength(1);
    expect(await store.listActive()).toHaveLength(0);

    // The registration was cleaned up on resume: a duplicate delivery cannot
    // re-trigger anything.
    const duplicate = await fetch(`http://127.0.0.1:${server.getPort()}/approved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true, by: 'reviewer-2' }),
    });
    expect(duplicate.status).toBe(404);
    expect((await log.read(result.executionId!)).map((e) => e.type)).toEqual(types);
  });

  it('an expired timeout pause resumes without any webhook', async () => {
    const dir = join(freshDir(), 'log');
    const log = new FileExecutionLog(dir);

    const source = `
      mission Delayed {
        store out: memory("out")
        action Wait {
          pause { duration: "150ms" }
          let record = { id: "r1", done: true }
          store record -> out
        }
        run Wait
      }
    `;

    const result = await executeWithResume(source, { executionLog: log }, { pollInterval: 40 });

    expect(result.success).toBe(true);
    expect(await result.stores.get('out')!.list()).toHaveLength(1);

    const types = (await log.read(result.executionId!)).map((e) => e.type);
    expect(types.filter((t) => t === 'pause.created')).toHaveLength(1);
    expect(types.filter((t) => t === 'pause.resumed')).toHaveLength(1);
    expect(types.filter((t) => t === 'mission.completed')).toHaveLength(1);
  });

  it('refuses to run without a durable execution log', async () => {
    await expect(executeWithResume(webhookMission, {})).rejects.toThrow(/executionLog/);
  });
});
