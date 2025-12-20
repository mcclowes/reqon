#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fromFile, parse, Scheduler } from './index.js';
import type { ScheduleEvent } from './scheduler/index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Reqon - A DSL for fetch, map, validate pipelines

Usage:
  reqon <file.reqon> [options]

Options:
  --dry-run        Run without making actual HTTP requests
  --verbose        Enable verbose logging
  --auth <file>    JSON file with auth credentials
  --output <path>  Export stores to JSON (file or directory)
  --daemon         Run as daemon, executing scheduled missions
  --once           Run scheduled missions once immediately, then exit
  --help, -h       Show this help message

Examples:
  reqon sync-invoices.reqon --verbose
  reqon sync-invoices.reqon --auth ./credentials.json
  reqon sync-invoices.reqon --output ./output.json
  reqon sync-invoices.reqon --daemon --verbose
`);
    process.exit(0);
  }

  const filePath = args[0];
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const daemon = args.includes('--daemon');
  const once = args.includes('--once');

  let auth: Record<string, unknown> | undefined;
  const authIndex = args.indexOf('--auth');
  if (authIndex !== -1 && args[authIndex + 1]) {
    const authPath = resolve(args[authIndex + 1]);
    const authContent = await readFile(authPath, 'utf-8');
    auth = JSON.parse(authContent);
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

  try {
    const result = await fromFile(filePath, {
      dryRun,
      verbose,
      auth: auth as Record<string, { type: 'bearer' | 'oauth2'; token?: string; accessToken?: string }>,
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
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
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
  const source = await readFile(absolutePath, 'utf-8');
  const program = parse(source);

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
