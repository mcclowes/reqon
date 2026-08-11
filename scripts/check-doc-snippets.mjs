#!/usr/bin/env node
/**
 * Verify that fenced Reqon/Vague code blocks in the docs actually lex and parse.
 *
 * - Every ```reqon / ```vague block is lexed (catches stray characters like `!`).
 * - Every such block that declares a `mission` or a top-level `schema` is fully
 *   parsed (catches structural/option errors). Other partial snippets are lexed
 *   only.
 *
 * Usage: node scripts/check-doc-snippets.mjs [path...]
 * Paths may be files or directories; defaults to the docs site plus the root
 * markdown files. Exits non-zero if any block fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReqonLexer, parse } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TARGETS = [
  'docusaurus/docs',
  'README.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'DURABILITY.md',
  'examples/README.md',
  // The agent-facing DSL reference drifts the same way the docs do, and nothing
  // else reads it closely enough to notice.
  '.claude/skills/reqon',
].map((p) => join(root, p));
const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS;

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
  // A schema shown next to a loose step (`schema Order {...}` then `match order
  // {...}`). The schema itself parsed; the step just has no action to live in.
  /Unexpected token: (match|get|post|put|patch|delete|for|map|validate|store|call|wait|pause|run)$/,
];
const isPartial = (msg) => PARTIAL_SNIPPET.some((re) => re.test(msg));

// Only a real declaration counts, not the word in a comment ("aborts the
// mission if ..." used to trigger a full parse of a two-line snippet).
const stripComments = (src) => src.replace(/\/\/[^\n]*/g, '');
const DECLARES = /^[ \t]*(mission|schema)\s+\w+/m;
const declaresTopLevel = (body) => DECLARES.test(stripComments(body));

function walk(target) {
  if (!statSync(target).isDirectory()) return /\.mdx?$/.test(target) ? [target] : [];
  const out = [];
  for (const entry of readdirSync(target)) {
    const p = join(target, entry);
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

const files = [...new Set(targets.flatMap(walk))].sort();

for (const file of files) {
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
    // Full parse only for blocks that declare something top-level.
    if (declaresTopLevel(body)) {
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
