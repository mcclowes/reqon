// Temporal Worker Setup
// This is infrastructure code that Reqon doesn't require at all
// Reqon runs as a simple CLI or library - no workers, no server cluster

import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from '../activities';

// Worker configuration
const TASK_QUEUE = 'order-reconciliation';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';

async function run() {
  console.log('Starting Order Reconciliation Worker...');
  console.log(`Connecting to Temporal at ${TEMPORAL_ADDRESS}`);
  console.log(`Namespace: ${TEMPORAL_NAMESPACE}`);

  // Connect to Temporal server
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  try {
    // Create worker
    const worker = await Worker.create({
      connection,
      namespace: TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('../workflows/orderReconciliation'),
      activities,
      // Worker tuning options
      maxConcurrentWorkflowTaskExecutions: 10,
      maxConcurrentActivityTaskExecutions: 20,
      maxCachedWorkflows: 100,
      // Sticky execution options
      stickyQueueScheduleToStartTimeout: '10s',
    });

    console.log(`Worker listening on task queue: ${TASK_QUEUE}`);

    // Register shutdown handlers
    const shutdown = async () => {
      console.log('Shutting down worker...');
      await worker.shutdown();
      await connection.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start the worker
    await worker.run();
  } catch (error) {
    console.error('Worker error:', error);
    await connection.close();
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

/*
 * INFRASTRUCTURE REQUIREMENTS FOR TEMPORAL:
 *
 * 1. Temporal Server Cluster:
 *    - Frontend service (gRPC API)
 *    - History service (workflow state)
 *    - Matching service (task routing)
 *    - Worker service (internal tasks)
 *
 * 2. Database:
 *    - PostgreSQL, MySQL, or Cassandra
 *    - For workflow history and visibility
 *
 * 3. Elasticsearch (optional):
 *    - For advanced workflow search
 *
 * 4. Prometheus + Grafana (recommended):
 *    - For metrics and monitoring
 *
 * 5. Docker Compose or Kubernetes:
 *    - For orchestrating all services
 *
 * Example docker-compose.yml (simplified):
 *
 * version: '3.8'
 * services:
 *   postgresql:
 *     image: postgres:13
 *     environment:
 *       POSTGRES_PASSWORD: temporal
 *       POSTGRES_USER: temporal
 *       POSTGRES_DB: temporal
 *
 *   temporal:
 *     image: temporalio/auto-setup:latest
 *     depends_on:
 *       - postgresql
 *     environment:
 *       - DB=postgresql
 *       - DB_PORT=5432
 *       - POSTGRES_USER=temporal
 *       - POSTGRES_PWD=temporal
 *       - POSTGRES_SEEDS=postgresql
 *     ports:
 *       - "7233:7233"
 *
 *   temporal-admin-tools:
 *     image: temporalio/admin-tools:latest
 *     depends_on:
 *       - temporal
 *
 *   temporal-ui:
 *     image: temporalio/ui:latest
 *     depends_on:
 *       - temporal
 *     ports:
 *       - "8080:8080"
 *
 * COMPARE TO REQON:
 *
 *   $ reqon reconciliation.reqon --auth ./credentials.json
 *
 * That's it. No infrastructure. No workers. No database setup.
 * Just a single command that runs anywhere Node.js is available.
 */
