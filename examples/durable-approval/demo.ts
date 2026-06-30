/**
 * Flagship demo (#143): a resource-free long wait that survives a restart.
 *
 * Run it:  npx tsx examples/durable-approval/demo.ts
 *
 * The script runs the approval mission against a *file-backed* execution log, so
 * the durable state lives on disk. It deliberately uses a brand-new executor for
 * the resume step — nothing is shared in memory — to model a real process
 * restart / redeploy between the pause and the webhook.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute, FileExecutionLog, LogBackedPauseStore } from '../../src/index.js';

const source = `
  mission Approval {
    source Api { auth: none, base: "https://api.example.test" }
    store approvals: memory("approvals")
    action AwaitApproval {
      pause { duration: "30d", resumeOn: webhook "/approved" }
      let record = { id: "req-1", status: "approved" }
      store record -> approvals { key: .id }
    }
    run AwaitApproval
  }
`;

async function main() {
  const dir = join(mkdtempSync(join(tmpdir(), 'reqon-approval-')), 'log');

  // ── Process 1: start the run. It pauses waiting on the webhook. ──
  console.log('▶  Starting approval mission…');
  const first = await execute(source, { executionLog: new FileExecutionLog(dir) });
  console.log(`⏸  Paused (execution ${first.executionId}). Holding zero compute.`);

  // The waiting pause is discoverable from the durable log alone.
  const waiting = await new LogBackedPauseStore(new FileExecutionLog(dir)).listActive();
  console.log(`   Durable log shows ${waiting.length} pause waiting on:`, waiting[0]?.expiresAt);

  console.log('\n💥  …simulating a full process restart / redeploy…\n');

  // ── Process 2 (fresh executor): the webhook arrived — resume. ──
  console.log('▶  Webhook received — resuming on a brand-new process…');
  const second = await execute(source, {
    executionLog: new FileExecutionLog(dir),
    resumeFrom: first.executionId,
  });

  console.log(
    `✅  Resumed and ${second.success ? 'completed' : 'FAILED'} (execution ${second.executionId}).`
  );
  const stillWaiting = await new LogBackedPauseStore(new FileExecutionLog(dir)).listActive();
  console.log(`   Pauses still active: ${stillWaiting.length}`);

  rmSync(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
