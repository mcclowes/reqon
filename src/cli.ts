#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fromPath, parse, Scheduler, loadMission } from './index.js';
import type { ScheduleEvent } from './scheduler/index.js';
import { ReqonError } from './errors/index.js';
import { loadEnv, loadCredentials } from './auth/credentials.js';
import { WebhookServer } from './webhook/index.js';
import type { DebugController } from './debug/index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Reqon - A DSL for fetch, map, validate pipelines

Usage:
  reqon <file.reqon|folder> [options]

Options:
  --dry-run            Run without making actual HTTP requests
  --verbose            Enable verbose logging
  --auth <file>        JSON file with auth credentials (supports env var interpolation)
  --env <file>         Path to .env file (default: .env in current directory)
  --output <path>      Export stores to JSON (file or directory)
  --daemon             Run as daemon, executing scheduled missions
  --once               Run scheduled missions once immediately, then exit
  --webhook            Enable webhook server for 'wait' steps
  --webhook-port <n>   Port for webhook server (default: 3000)
  --webhook-url <url>  Base URL for webhook endpoints (default: http://localhost:3000)
  --debug              Enable step-through debugging
  --help, -h           Show this help message

Environment Variables:
  Credentials in --auth files support env var interpolation:
    $VAR_NAME, \${VAR_NAME}, \${VAR_NAME:-default}

  Auto-discovery from env vars (no --auth file needed):
    REQON_{SOURCE}_TOKEN      Bearer token for source
    REQON_{SOURCE}_TYPE       Auth type (bearer, oauth2, api_key, basic)
    REQON_{SOURCE}_API_KEY    API key for source

Examples:
  reqon sync-invoices.reqon --verbose
  reqon ./sync-invoices/ --verbose        # folder with mission.reqon + action files
  reqon sync-invoices.reqon --auth ./credentials.json
  reqon sync-invoices.reqon --env .env.production --auth ./credentials.json
  reqon sync-invoices.reqon --output ./output.json
  reqon sync-invoices.reqon --daemon --verbose
  reqon sync-invoices.reqon --webhook --webhook-port 8080 --verbose
`);
    process.exit(0);
  }

  const filePath = args[0];
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const daemon = args.includes('--daemon');
  const once = args.includes('--once');
  const webhookEnabled = args.includes('--webhook');
  const debugEnabled = args.includes('--debug');

  // Parse webhook options
  let webhookPort = 3000;
  const webhookPortIndex = args.indexOf('--webhook-port');
  if (webhookPortIndex !== -1 && args[webhookPortIndex + 1]) {
    webhookPort = parseInt(args[webhookPortIndex + 1], 10);
  }

  let webhookUrl: string | undefined;
  const webhookUrlIndex = args.indexOf('--webhook-url');
  if (webhookUrlIndex !== -1 && args[webhookUrlIndex + 1]) {
    webhookUrl = args[webhookUrlIndex + 1];
  }

  // Load .env file(s)
  let envFile: string | undefined;
  const envIndex = args.indexOf('--env');
  if (envIndex !== -1 && args[envIndex + 1]) {
    envFile = args[envIndex + 1];
  }

  const envResult = loadEnv({ envFile });
  if (verbose && envResult.loaded) {
    console.log(`Loaded ${envResult.count} env vars from: ${envResult.files.join(', ')}`);
  }

  // Load and resolve auth credentials
  let auth: Record<string, unknown> | undefined;
  const authIndex = args.indexOf('--auth');
  if (authIndex !== -1 && args[authIndex + 1]) {
    const authPath = resolve(args[authIndex + 1]);
    const authContent = await readFile(authPath, 'utf-8');
    const rawAuth = JSON.parse(authContent);
    // Resolve env var references in the auth config
    auth = loadCredentials(rawAuth);
  }

  let outputPath: string | undefined;
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputPath = resolve(args[outputIndex + 1]);
  }

  // Daemon mode: run scheduled missions
  if (daemon || once) {
    await runDaemon(filePath, {
      verbose,
      dryRun,
      auth: auth as Record<string, { type: 'bearer' | 'oauth2'; token?: string; accessToken?: string }>,
      once,
    });
    return;
  }

  // Single run mode (default)
  console.log(`Running: ${filePath}`);

  // Start webhook server if enabled
  let webhookServer: WebhookServer | undefined;
  if (webhookEnabled) {
    webhookServer = new WebhookServer({
      port: webhookPort,
      baseUrl: webhookUrl ?? `http://localhost:${webhookPort}`,
      verbose,
    });
    await webhookServer.start();
    console.log(`Webhook server started on port ${webhookPort}`);
  }

  // Initialize debug controller if enabled
  let debugController: DebugController | undefined;
  if (debugEnabled) {
    const { CLIDebugger } = await import('./debug/cli-debugger.js');
    debugController = new CLIDebugger();
    console.log('Debug mode enabled. Commands: c(ontinue), s(tep), si(step-into), so(step-over), q(uit)');
    console.log('Type "help" at the debug prompt for more commands.\n');
  }

  try {
    const result = await fromPath(filePath, {
      dryRun,
      verbose,
      auth: auth as Record<string, { type: 'bearer' | 'oauth2'; token?: string; accessToken?: string }>,
      webhookServer,
      debugController,
    });

    if (result.success) {
      console.log(`\n✓ Mission completed successfully`);
      console.log(`  Duration: ${result.duration}ms`);
      console.log(`  Actions run: ${result.actionsRun.join(' → ')}`);

      // Print store stats and optionally export
      const storeData: Record<string, unknown[]> = {};
      for (const [name, store] of result.stores) {
        const items = await store.list();
        console.log(`  Store "${name}": ${items.length} items`);
        storeData[name] = items;
      }

      // Export to JSON if requested
      if (outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(storeData, null, 2));
        console.log(`  Output written to: ${outputPath}`);
      }
    } else {
      console.log(`\n✗ Mission failed`);
      for (const error of result.errors) {
        console.error(`  [${error.action}/${error.step}] ${error.message}`);
      }
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof ReqonError) {
      console.error(error.format());
    } else {
      console.error(`Error: ${(error as Error).message}`);
    }
    process.exit(1);
  } finally {
    // Stop webhook server if it was started
    if (webhookServer) {
      await webhookServer.stop();
    }
    // Close debug controller if it was started
    if (debugController?.close) {
      debugController.close();
    }
  }
}

interface DaemonOptions {
  verbose: boolean;
  dryRun: boolean;
  auth?: Record<string, { type: 'bearer' | 'oauth2'; token?: string; accessToken?: string }>;
  once: boolean;
}

async function runDaemon(filePath: string, options: DaemonOptions): Promise<void> {
  const absolutePath = resolve(filePath);

  let program;
  let baseDir: string;
  try {
    const result = await loadMission(absolutePath);
    program = result.program;
    baseDir = result.baseDir;
  } catch (error) {
    if (error instanceof ReqonError) {
      console.error(error.format());
    } else {
      console.error(`Error loading mission: ${(error as Error).message}`);
    }
    process.exit(1);
  }

  // Find scheduled missions
  const scheduledMissions = program.statements.filter(
    (s) => s.type === 'MissionDefinition' && s.schedule
  );

  if (scheduledMissions.length === 0) {
    console.error('No scheduled missions found in the file');
    console.error('Add a schedule to your mission, e.g.:');
    console.error('  schedule: every 6 hours');
    console.error('  schedule: cron "0 */6 * * *"');
    process.exit(1);
  }

  console.log(`Found ${scheduledMissions.length} scheduled mission(s)`);

  // Create scheduler with callbacks
  const scheduler = new Scheduler(
    {
      verbose: options.verbose,
      callbacks: {
        onJobStarted: (event: ScheduleEvent) => {
          console.log(`[${formatTime(event.timestamp)}] Starting: ${event.missionName}`);
        },
        onJobCompleted: (event: ScheduleEvent) => {
          console.log(
            `[${formatTime(event.timestamp)}] Completed: ${event.missionName} (${event.duration}ms)`
          );
        },
        onJobFailed: (event: ScheduleEvent) => {
          console.error(
            `[${formatTime(event.timestamp)}] Failed: ${event.missionName} - ${event.error}`
          );
        },
        onJobSkipped: (event: ScheduleEvent) => {
          console.log(
            `[${formatTime(event.timestamp)}] Skipped: ${event.missionName} - ${event.reason}`
          );
        },
      },
    },
    {
      dryRun: options.dryRun,
      verbose: options.verbose,
      auth: options.auth,
    }
  );

  // Register scheduled missions
  scheduler.registerProgram(program, absolutePath);

  // Print job info
  const jobs = scheduler.getJobs();
  console.log('\nScheduled jobs:');
  for (const job of jobs) {
    const schedule = job.schedule;
    let scheduleStr: string;
    if (schedule.scheduleType === 'interval') {
      scheduleStr = `every ${schedule.interval!.value} ${schedule.interval!.unit}`;
    } else if (schedule.scheduleType === 'cron') {
      scheduleStr = `cron "${schedule.cronExpression}"`;
    } else {
      scheduleStr = `at "${schedule.runAt}"`;
    }
    console.log(`  - ${job.missionName}: ${scheduleStr}`);
    if (job.nextRun) {
      console.log(`    Next run: ${job.nextRun.toISOString()}`);
    }
  }
  console.log('');

  // Handle --once mode
  if (options.once) {
    console.log('Running all scheduled missions once...\n');
    for (const job of jobs) {
      await scheduler.trigger(job.missionName);
    }
    console.log('\nAll missions completed.');
    return;
  }

  // Start daemon mode
  console.log('Starting scheduler daemon (Ctrl+C to stop)...\n');

  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down scheduler...');
    await scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the scheduler
  await scheduler.start();

  // Keep the process running
  await new Promise(() => {
    // This promise never resolves - we wait for SIGINT/SIGTERM
  });
}

function formatTime(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

main();
