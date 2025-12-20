#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fromFile } from './index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Reqon - A DSL for fetch, map, validate pipelines

Usage:
  reqon <file.reqon> [options]

Options:
  --dry-run     Run without making actual HTTP requests
  --verbose     Enable verbose logging
  --auth <file> JSON file with auth credentials
  --help, -h    Show this help message

Example:
  reqon sync-invoices.reqon --verbose
  reqon sync-invoices.reqon --auth ./credentials.json
`);
    process.exit(0);
  }

  const filePath = args[0];
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  let auth: Record<string, unknown> | undefined;
  const authIndex = args.indexOf('--auth');
  if (authIndex !== -1 && args[authIndex + 1]) {
    const authPath = resolve(args[authIndex + 1]);
    const authContent = await readFile(authPath, 'utf-8');
    auth = JSON.parse(authContent);
  }

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

      // Print store stats
      for (const [name, store] of result.stores) {
        const items = await store.list();
        console.log(`  Store "${name}": ${items.length} items`);
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

main();
