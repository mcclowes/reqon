#!/usr/bin/env node
/**
 * ---
 * purpose: CLI entry point - parses args and runs missions
 * inputs:
 *   - file.reqon or folder path
 *   - --dry-run, --verbose, --auth, --env, --output, --daemon, --webhook, --debug
 * related:
 *   - ./index.ts - library APIs used by CLI
 *   - ./scheduler/index.ts - daemon mode scheduling
 *   - ./webhook/index.ts - webhook server for wait steps
 *   - ./debug/cli-debugger.ts - interactive debugging
 * ---
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fromPath,
  Scheduler,
  loadMission,
  createEmitter,
  createStructuredLogger,
  ProgressReporter,
  formatProgressLine,
  type EventEmitter,
  type StructuredLogger,
  type LogLevel,
  type ProgressSnapshot,
  type AuthConfig,
} from './index.js';
import type { ScheduleEvent } from './scheduler/index.js';
import { ReqonError } from './errors/index.js';
import { loadEnv, loadCredentials } from './auth/credentials.js';
import { WebhookServer } from './webhook/index.js';
import type { DebugController } from './debug/index.js';
import { ControlServer } from './control/index.js';
import {
  buildDatasetReport,
  compareDatasetOutput,
  formatDatasetReport,
  reportFormatFromPath,
} from './reporting/index.js';

/** Valid values for `--log-level`, quietest last. */
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Read the value following a flag, e.g. `--log-level info` -> "info". */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
}

interface Observability {
  /** Passed to the executor as its logger (undefined = quiet default). */
  logger?: StructuredLogger;
  /** Passed to the executor so events flow to the progress reporter. */
  eventEmitter?: EventEmitter;
  /** Whether the executor's rate-limit/circuit narration should be installed. */
  verbose: boolean;
  /** Print the final progress line and detach subscriptions. */
  finish(): void;
}

/**
 * Resolve `--log-level` / `--verbose` / `--log-format` into a logger and, when
 * the level is info-or-lower, a {@link ProgressReporter} that folds the event
 * stream into a single throttled progress line.
 *
 * - `--verbose` is an alias for `--log-level info`.
 * - At `info`, per-item narration (which sits at `debug`) is hidden and the
 *   progress line shows; at `debug` you get both.
 * - `--log-format json` swaps the human console output and the progress line
 *   for JSON lines.
 */
function setupObservability(args: string[], missionPath: string): Observability {
  const explicitLevel = flagValue(args, '--log-level');
  if (explicitLevel && !LOG_LEVELS.includes(explicitLevel as LogLevel)) {
    throw new Error(
      `invalid --log-level "${explicitLevel}" (expected one of: ${LOG_LEVELS.join(', ')})`
    );
  }

  const level: LogLevel | undefined =
    (explicitLevel as LogLevel | undefined) ?? (args.includes('--verbose') ? 'info' : undefined);

  const format = flagValue(args, '--log-format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`invalid --log-format "${format}" (expected "text" or "json")`);
  }

  // No level requested: stay quiet (only the run summary), like before.
  if (!level) {
    return { verbose: false, finish: () => {} };
  }

  const logger = createStructuredLogger({
    prefix: 'Reqon',
    level,
    console: format === 'text',
    jsonLines: format === 'json',
    time: 'elapsed',
  });

  // The progress line only makes sense at info or debug; at warn/error stay silent.
  const wantProgress = LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf('info');
  if (!wantProgress) {
    return { logger, verbose: true, finish: () => {} };
  }

  const emitter = createEmitter('cli', missionPath);
  const render =
    format === 'json'
      ? (s: ProgressSnapshot) => console.log(JSON.stringify({ type: 'progress', ...s }))
      : (s: ProgressSnapshot) => console.log(formatProgressLine(s));
  const reporter = new ProgressReporter(emitter, { onSnapshot: render });

  let finished = false;
  return {
    logger,
    eventEmitter: emitter,
    verbose: true,
    finish: () => {
      if (finished) return;
      finished = true;
      reporter.finish();
      reporter.stop();
    },
  };
}

/**
 * Load and resolve an --auth credentials file, turning low-level fs/JSON
 * failures into clean, user-facing messages instead of raw stack traces.
 */
export async function loadAuthFile(rawPath: string): Promise<Record<string, unknown>> {
  const authPath = resolve(rawPath);

  let authContent: string;
  try {
    authContent = await readFile(authPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`auth file not found: ${authPath}`, { cause: err });
    }
    if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
      throw new Error(`auth path is a directory, not a file: ${authPath}`, { cause: err });
    }
    throw new Error(`could not read auth file ${authPath}: ${(err as Error).message}`, {
      cause: err,
    });
  }

  let rawAuth: unknown;
  try {
    rawAuth = JSON.parse(authContent);
  } catch {
    throw new Error(`auth file is not valid JSON: ${authPath}`);
  }

  // Resolve env var references in the auth config
  return loadCredentials(rawAuth as Record<string, unknown>);
}

/**
 * Report items a loop skipped past.
 *
 * Loops continue by default, so a run can finish "successfully" having dropped
 * a lot on the floor. Summarised here, with a sample, so that never passes
 * unnoticed - the counts are the signal that a shard needs re-sweeping.
 */
function printToleratedFailures(
  failures: { action: string; index: number; error: string }[] | undefined
): void {
  if (!failures?.length) return;

  console.log(`  ⚠ Skipped ${failures.length} failed ${failures.length === 1 ? 'item' : 'items'}`);

  const byError = new Map<string, number>();
  for (const f of failures) {
    byError.set(f.error, (byError.get(f.error) ?? 0) + 1);
  }
  const ranked = [...byError.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [message, count] of ranked) {
    console.log(`      ${count}x ${message.slice(0, 100)}`);
  }
  if (byError.size > ranked.length) {
    console.log(`      ...and ${byError.size - ranked.length} other distinct errors`);
  }
}

/**
 * Print an error in a clean, user-facing form (no stack trace). ReqonErrors
 * get their rich source-context formatting; everything else gets a one-line
 * message.
 */
export function reportFatalError(error: unknown): void {
  if (error instanceof ReqonError) {
    console.error(error.format());
  } else if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(`Error: ${String(error)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Reqon - A DSL for fetch, map, validate pipelines

Usage:
  reqon <file.reqon|folder> [options]

Options:
  --dry-run            Run without making actual HTTP requests
  --verbose            Alias for --log-level info (shows a live progress line)
  --log-level <level>  Log verbosity: debug, info, warn, error (default: quiet)
                       info shows a throttled progress line; debug adds per-item narration
  --log-format <fmt>   Log output format: text (default) or json (JSON Lines)
  --dev                Development mode: let sql/nosql stores fall back to local JSON files
  --auth <file>        JSON file with auth credentials (supports env var interpolation)
  --env <file>         Path to .env file (default: .env in current directory)
  --output <path>      Export all stores to a single JSON file, keyed by store name
  --report <path>      Write Vague dataset statistics (.json, .md, or .html)
  --compare <path>     Compare stores with a golden JSON dataset; fail on differences
  --daemon             Run as daemon, executing scheduled missions
  --once               Run scheduled missions once immediately, then exit
  --webhook            Enable webhook server for 'wait' steps
  --webhook-port <n>   Port for webhook server (default: 3000)
  --webhook-url <url>  Base URL for webhook endpoints (default: http://localhost:3000)
  --control            Enable control server for pause/resume and status queries
  --control-port <n>   Port for control server (default: 3001)
  --debug              Enable step-through debugging
  --resume <id>        Resume a paused or failed execution by ID
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
  reqon sync-invoices.reqon --control --verbose   # enable control server
  reqon sync-invoices.reqon --resume exec_abc123  # resume paused execution

Control Server:
  When --control is enabled, the server exposes these endpoints:
    POST /pause    Request graceful pause at next safe point
    POST /resume   Clear pause request
    GET  /status   Get current execution state and progress
    GET  /health   Health check
`);
    process.exit(0);
  }

  const filePath = args[0];
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const devMode = args.includes('--dev');
  const daemon = args.includes('--daemon');
  const once = args.includes('--once');
  const webhookEnabled = args.includes('--webhook');
  const debugEnabled = args.includes('--debug');
  const controlEnabled = args.includes('--control');

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

  // Parse control server options
  let controlPort = 3001;
  const controlPortIndex = args.indexOf('--control-port');
  if (controlPortIndex !== -1 && args[controlPortIndex + 1]) {
    controlPort = parseInt(args[controlPortIndex + 1], 10);
  }

  // Parse resume option
  let resumeFrom: string | undefined;
  const resumeIndex = args.indexOf('--resume');
  if (resumeIndex !== -1 && args[resumeIndex + 1]) {
    resumeFrom = args[resumeIndex + 1];
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
    auth = await loadAuthFile(args[authIndex + 1]);
  }

  let outputPath: string | undefined;
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputPath = resolve(args[outputIndex + 1]);
  }

  const rawReportPath = flagValue(args, '--report');
  const reportPath = rawReportPath ? resolve(rawReportPath) : undefined;
  const rawComparePath = flagValue(args, '--compare');
  const comparePath = rawComparePath ? resolve(rawComparePath) : undefined;

  // Daemon mode: run scheduled missions
  if (daemon || once) {
    await runDaemon(filePath, {
      verbose,
      dryRun,
      auth: auth as Record<string, AuthConfig>,
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

  // Start control server if enabled
  let controlServer: ControlServer | undefined;
  if (controlEnabled) {
    controlServer = new ControlServer({ port: controlPort, verbose });
    await controlServer.start();
    console.log(`Control server started on port ${controlPort}`);
    console.log(`  POST http://localhost:${controlPort}/pause  - request pause`);
    console.log(`  GET  http://localhost:${controlPort}/status - check status`);
  }

  // Initialize debug controller if enabled
  let debugController: DebugController | undefined;
  if (debugEnabled) {
    const { CLIDebugger } = await import('./debug/cli-debugger.js');
    debugController = new CLIDebugger();
    console.log(
      'Debug mode enabled. Commands: c(ontinue), s(tep), si(step-into), so(step-over), q(uit)'
    );
    console.log('Type "help" at the debug prompt for more commands.\n');
  }

  // Resolve --log-level / --verbose / --log-format into a logger and (at
  // info-or-lower) a progress reporter fed by the mission's event stream.
  const obs = setupObservability(args, filePath);

  try {
    const result = await fromPath(filePath, {
      dryRun,
      verbose: obs.verbose,
      logger: obs.logger,
      eventEmitter: obs.eventEmitter,
      developmentMode: devMode,
      auth: auth as Record<string, AuthConfig>,
      webhookServer,
      debugController,
      controlServer,
      resumeFrom,
    });

    // Print the closing progress line before the run summary (the finally block
    // is a no-op safety net thanks to finish()'s idempotency).
    obs.finish();

    // Check if execution was paused
    const isPaused = result.state?.status === 'paused';

    if (isPaused) {
      console.log(`\n⏸ Mission paused`);
      console.log(`  Duration: ${result.duration}ms`);
      console.log(`  Actions run: ${result.actionsRun.join(' → ')}`);
      console.log(`  Execution ID: ${result.executionId}`);
      console.log(`\n  To resume: reqon ${filePath} --resume ${result.executionId}`);
    } else if (result.success) {
      console.log(`\n✓ Mission completed successfully`);
      console.log(`  Duration: ${result.duration}ms`);
      console.log(`  Actions run: ${result.actionsRun.join(' → ')}`);
      printToleratedFailures(result.toleratedFailures);

      // Print store stats and optionally export
      const storeData: Record<string, unknown[]> = {};
      for (const [name, store] of result.stores) {
        const items = await store.list();
        console.log(`  Store "${name}": ${items.length} ${items.length === 1 ? 'item' : 'items'}`);
        storeData[name] = items;
      }

      // Export to JSON if requested
      if (outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(storeData, null, 2));
        console.log(`  Output written to: ${outputPath}`);
      }

      if (reportPath) {
        let schemaSource = filePath;
        try {
          schemaSource = await readFile(resolve(filePath), 'utf-8');
        } catch {
          // Folder missions have several sources; the path is still a stable
          // report identifier when there is no single schema source.
        }
        const report = buildDatasetReport(storeData, schemaSource, result.duration);
        await mkdir(dirname(reportPath), { recursive: true });
        await writeFile(
          reportPath,
          formatDatasetReport(report, reportFormatFromPath(reportPath)),
          'utf-8'
        );
        console.log(`  Dataset report written to: ${reportPath}`);
      }

      if (comparePath) {
        const expected = JSON.parse(await readFile(comparePath, 'utf-8')) as Record<
          string,
          unknown[]
        >;
        const comparison = compareDatasetOutput(expected, storeData);
        console.log(comparison.formatted);
        if (!comparison.result.identical) process.exitCode = 1;
      }
    } else {
      console.log(`\n✗ Mission failed`);
      for (const error of result.errors) {
        console.error(`  [${error.action}/${error.step}] ${error.message}`);
      }
      if (result.executionId) {
        console.log(`\n  Execution ID: ${result.executionId}`);
        console.log(`  To resume: reqon ${filePath} --resume ${result.executionId}`);
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
    // Emit the final progress line and detach the reporter.
    obs.finish();
    // Stop webhook server if it was started
    if (webhookServer) {
      await webhookServer.stop();
    }
    // Stop control server if it was started
    if (controlServer) {
      await controlServer.stop();
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
  auth?: Record<string, AuthConfig>;
  once: boolean;
}

async function runDaemon(filePath: string, options: DaemonOptions): Promise<void> {
  const absolutePath = resolve(filePath);

  let program;
  try {
    const result = await loadMission(absolutePath);
    program = result.program;
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

// Only auto-run when invoked directly as the CLI entry point, so the module can
// be imported in tests without executing main() against the test runner's argv.
const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  // A rejected promise anywhere (including outside main's try/catch) should
  // surface as a clean message and a non-zero exit, never a raw stack trace.
  process.on('unhandledRejection', (reason) => {
    reportFatalError(reason);
    process.exit(1);
  });

  main().catch((error) => {
    reportFatalError(error);
    process.exit(1);
  });
}
