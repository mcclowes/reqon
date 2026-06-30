import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../index.js';
import { FileExecutionLog } from '../execution-log/index.js';
import { LogBackedPauseStore } from '../pause/index.js';

/**
 * Flagship (#143): a mission pauses for a webhook, the process restarts, and the
 * run resumes from the durable log and finishes — the resource-free long wait
 * that Temporal charges a cluster for, as a declarative one-liner.
 *
 * This proves restart survival for real: each run is a brand-new executor over a
 * file-backed log, with nothing shared in memory between them.
 */
describe('flagship: pause for a webhook, restart, resume', () => {
  const dirs: string[] = [];
  const freshDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'reqon-flagship-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  const source = `
    mission Approval {
      source Api { auth: none, base: "https://api.example.test" }
      store approvals: memory("approvals")
      action AwaitApproval {
        pause {
          duration: "30d",
          resumeOn: webhook "/approved"
        }
        let record = { id: "req-1", status: "approved" }
        store record -> approvals { key: .id }
      }
      run AwaitApproval
    }
  `;

  it('suspends on the pause, then a fresh process resumes it to completion', async () => {
    const dir = join(freshDir(), 'log');

    // Process 1: starts the run; it pauses waiting on the webhook.
    const first = await execute(source, { executionLog: new FileExecutionLog(dir) });
    {
      const log = new FileExecutionLog(dir);
      const types = (await log.read(first.executionId!)).map((e) => e.type);
      expect(types).toContain('pause.created');
      expect(types).not.toContain('mission.completed');

      // The waiting pause is discoverable from the durable log alone.
      const waiting = await new LogBackedPauseStore(log).listActive();
      expect(waiting).toHaveLength(1);
      expect(waiting[0].executionId).toBe(first.executionId);
    }

    // Process 2 (simulated restart — brand-new log instance, nothing shared):
    // the webhook has arrived, so resume the run.
    const second = await execute(source, {
      executionLog: new FileExecutionLog(dir),
      resumeFrom: first.executionId,
    });

    expect(second.success).toBe(true);
    expect(second.executionId).toBe(first.executionId);

    const log = new FileExecutionLog(dir);
    const types = (await log.read(first.executionId!)).map((e) => e.type);
    expect(types).toContain('pause.resumed');
    expect(types).toContain('mission.completed');

    // The pause is no longer active once resumed.
    expect(await new LogBackedPauseStore(log).listActive()).toHaveLength(0);
  });
});
