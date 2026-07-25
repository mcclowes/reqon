#!/usr/bin/env node
/**
 * Verify that fenced Reqon/Vague code blocks in the docs actually lex and parse.
 *
 * - Every ```reqon / ```vague block is lexed (catches stray characters like `!`).
 * - Every such block that contains a `mission` declaration is fully parsed
 *   (catches structural/option errors). Partial snippets are lexed only.
 *
 * Usage: node scripts/check-doc-snippets.mjs [docsDir]
 * Exits non-zero if any block fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReqonLexer, parse } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const docsDir = process.argv[2] ?? join(root, 'docusaurus/docs');

const LANGS = new Set(['reqon', 'vague']);
const FENCE = /```(\w+)?\r?\n([\s\S]*?)```/g;

// Semantic/completeness errors that just mean "this is an intentional partial
// snippet" rather than wrong syntax. These are not doc bugs, so we ignore them.
const PARTIAL_SNIPPET = [
  /Mission must have a run pipeline/,
  /is not defined\. Available (stores|sources)/,
  /Source must have auth config/,
  /Source must have (a )?base URL/,
  /Program must contain at least one mission/,
  /No mission found/,
];
const isPartial = (msg) => PARTIAL_SNIPPET.some((re) => re.test(msg));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.mdx?$/.test(p)) out.push(p);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const failures = [];
let blocks = 0;
let parsed = 0;

for (const file of walk(docsDir).sort()) {
  const text = readFileSync(file, 'utf8');
  let m;
  while ((m = FENCE.exec(text)) !== null) {
    const lang = (m[1] ?? '').toLowerCase();
    if (!LANGS.has(lang)) continue;
    const body = m[2];
    const startLine = lineOf(text, m.index);
    blocks++;
    // Lex everything (catches char-level errors in partial snippets too).
    try {
      new ReqonLexer(body).tokenize();
    } catch (err) {
      failures.push({ file, startLine, phase: 'lex', message: String(err.message ?? err) });
      continue;
    }
    // Full parse only for complete missions.
    if (/\bmission\s+\w/.test(body)) {
      parsed++;
      try {
        parse(body);
      } catch (err) {
        const message = String(err.message ?? err);
        if (!isPartial(message)) failures.push({ file, startLine, phase: 'parse', message });
      }
    }
  }
}

const rel = (f) => relative(root, f);
if (failures.length === 0) {
  console.log(`OK: ${blocks} reqon/vague blocks (${parsed} full missions parsed), 0 failures`);
  process.exit(0);
}
console.log(`${failures.length} failing block(s) of ${blocks} (${parsed} full missions parsed):\n`);
for (const f of failures) {
  console.log(`${rel(f.file)}:~${f.startLine}  [${f.phase}] ${f.message.split('\n')[0]}`);
}
process.exit(1);
