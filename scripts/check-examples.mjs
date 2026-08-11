#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMission, parse } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = join(root, 'examples');

const targets = [];
for (const entry of readdirSync(examplesDir)) {
  const p = join(examplesDir, entry);
  if (!statSync(p).isDirectory()) continue;
  // Find .vague/.reqon files in this folder (recursively shallow)
  const files = readdirSync(p)
    .filter((f) => /\.(vague|reqon)$/.test(f))
    .filter((f) => /\bmission\s+[A-Za-z_]/.test(readFileSync(join(p, f), 'utf8')));
  if (files.length === 0) {
    // maybe subfolders (e.g. multi-source-sync)
    targets.push({ name: entry, path: p });
  } else if (files.some((f) => /^mission\./.test(f)) && files.length > 1) {
    targets.push({ name: entry, path: p });
  } else {
    for (const f of files) targets.push({ name: `${entry}/${f}`, path: join(p, f) });
  }
}

let failures = 0;
for (const t of targets) {
  try {
    const { program } = await loadMission(t.path);
    // basic sanity: parse succeeded
    process.stdout.write(`\x1b[32mOK\x1b[0m   ${t.name}\n`);
  } catch (err) {
    failures++;
    const msg = err?.message ?? String(err);
    process.stdout.write(`\x1b[31mFAIL\x1b[0m ${t.name}\n     ${msg.split('\n')[0]}\n`);
  }
}
process.stdout.write(`\n${targets.length - failures}/${targets.length} passed\n`);
process.exit(failures ? 1 : 0);
