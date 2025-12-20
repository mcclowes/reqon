// Temporal Client - Schedule and trigger workflows
// More boilerplate that Reqon doesn't need

import { Connection, Client, ScheduleClient } from '@temporalio/client';
import { orderReconciliationWorkflow } from '../workflows/orderReconciliation';

const TASK_QUEUE = 'order-reconciliation';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';

async function getClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  return new Client({
    connection,
    namespace: TEMPORAL_NAMESPACE,
  });
}

// Run workflow once
export async function runReconciliation(): Promise<void> {
  const client = await getClient();

  const workflowId = `order-reconciliation-${Date.now()}`;

  console.log(`Starting workflow: ${workflowId}`);

  const handle = await client.workflow.start(orderReconciliationWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId,
    // Workflow-level timeout
    workflowExecutionTimeout: '1h',
    // Retry policy for the entire workflow
    retry: {
      initialInterval: '1m',
      backoffCoefficient: 2,
      maximumAttempts: 3,
      maximumInterval: '10m',
    },
  });

  console.log(`Workflow started with run ID: ${handle.firstExecutionRunId}`);

  // Wait for completion
  const result = await handle.result();
  console.log('Workflow completed:', result);
}

// Create a schedule for daily runs
export async function createDailySchedule(): Promise<void> {
  const connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const scheduleClient = new ScheduleClient({
    connection,
    namespace: TEMPORAL_NAMESPACE,
  });

  const scheduleId = 'order-reconciliation-daily';

  try {
    // Delete existing schedule if present
    const existingHandle = scheduleClient.getHandle(scheduleId);
    await existingHandle.delete();
    console.log('Deleted existing schedule');
  } catch {
    // Schedule didn't exist
  }

  // Create new schedule
  await scheduleClient.create({
    scheduleId,
    spec: {
      // Run daily at 2 AM UTC
      calendars: [
        {
          hour: 2,
          minute: 0,
        },
      ],
    },
    action: {
      type: 'startWorkflow',
      workflowType: orderReconciliationWorkflow,
      taskQueue: TASK_QUEUE,
      workflowId: 'order-reconciliation-scheduled',
      args: [],
    },
    policies: {
      overlap: 'SKIP', // Skip if previous run still running
      catchupWindow: '1h', // Catch up missed runs within 1 hour
    },
  });

  console.log(`Created daily schedule: ${scheduleId}`);
}

// Query workflow status
export async function getWorkflowStatus(workflowId: string): Promise<void> {
  const client = await getClient();

  const handle = client.workflow.getHandle(workflowId);

  const description = await handle.describe();
  console.log('Workflow status:', description.status.name);

  // Query for detailed state
  const state = await handle.query('getStatus');
  console.log('Workflow state:', state);
}

// Cancel a running workflow
export async function cancelWorkflow(workflowId: string): Promise<void> {
  const client = await getClient();

  const handle = client.workflow.getHandle(workflowId);

  // Send cancel signal
  await handle.signal('cancel');
  console.log(`Sent cancel signal to workflow: ${workflowId}`);
}

// Pause a running workflow
export async function pauseWorkflow(workflowId: string): Promise<void> {
  const client = await getClient();

  const handle = client.workflow.getHandle(workflowId);

  await handle.signal('pause');
  console.log(`Sent pause signal to workflow: ${workflowId}`);
}

// Resume a paused workflow
export async function resumeWorkflow(workflowId: string): Promise<void> {
  const client = await getClient();

  const handle = client.workflow.getHandle(workflowId);

  await handle.signal('resume');
  console.log(`Sent resume signal to workflow: ${workflowId}`);
}

// CLI entry point
async function main() {
  const command = process.argv[2];
  const workflowId = process.argv[3];

  switch (command) {
    case 'run':
      await runReconciliation();
      break;
    case 'schedule':
      await createDailySchedule();
      break;
    case 'status':
      if (!workflowId) {
        console.error('Usage: schedule.ts status <workflowId>');
        process.exit(1);
      }
      await getWorkflowStatus(workflowId);
      break;
    case 'cancel':
      if (!workflowId) {
        console.error('Usage: schedule.ts cancel <workflowId>');
        process.exit(1);
      }
      await cancelWorkflow(workflowId);
      break;
    case 'pause':
      if (!workflowId) {
        console.error('Usage: schedule.ts pause <workflowId>');
        process.exit(1);
      }
      await pauseWorkflow(workflowId);
      break;
    case 'resume':
      if (!workflowId) {
        console.error('Usage: schedule.ts resume <workflowId>');
        process.exit(1);
      }
      await resumeWorkflow(workflowId);
      break;
    default:
      console.log('Usage: schedule.ts <command> [workflowId]');
      console.log('Commands: run, schedule, status, cancel, pause, resume');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

/*
 * REQON EQUIVALENT:
 *
 * # Run once
 * reqon reconciliation.reqon
 *
 * # Run with credentials
 * reqon reconciliation.reqon --auth ./credentials.json
 *
 * # Dry run (preview without API calls)
 * reqon reconciliation.reqon --dry-run
 *
 * # Resume from checkpoint
 * reqon reconciliation.reqon --resume execution-abc123
 *
 * # For scheduling, use cron or any scheduler:
 * 0 2 * * * reqon reconciliation.reqon >> /var/log/reqon.log
 *
 * No Temporal server. No workers. No client SDK.
 * Just a declarative DSL that runs anywhere.
 */
