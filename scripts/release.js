#!/usr/bin/env node

/**
 * Release script for reqon-dsl
 *
 * This script automates the release process:
 * 1. Validates the changelog has been updated
 * 2. Runs tests and build
 * 3. Creates and pushes a git tag
 *
 * Usage:
 *   npm run release           # Release current version
 *   npm run release -- --dry-run  # Preview without making changes
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');

function exec(cmd, options = {}) {
  console.log(`\n$ ${cmd}`);
  if (dryRun && !options.allowInDryRun) {
    console.log('  (skipped - dry run)');
    return '';
  }
  try {
    return execSync(cmd, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
  } catch (error) {
    if (options.ignoreError) {
      return '';
    }
    throw error;
  }
}

function getPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  return pkg.version;
}

function validateChangelog(version) {
  const changelog = readFileSync(join(rootDir, 'CHANGELOG.md'), 'utf-8');

  // Check if the version has an entry in the changelog
  const versionHeader = `## [${version}]`;
  if (!changelog.includes(versionHeader)) {
    console.error(`\nError: CHANGELOG.md does not contain an entry for version ${version}`);
    console.error(`Please add a section: ${versionHeader} - YYYY-MM-DD`);
    console.error('\nExample:');
    console.error(`${versionHeader} - ${new Date().toISOString().split('T')[0]}`);
    console.error('\n### Added');
    console.error('- Your new features here\n');
    process.exit(1);
  }

  // Check the version has a date (not just [Unreleased])
  const versionRegex = new RegExp(`## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`);
  if (!versionRegex.test(changelog)) {
    console.error(`\nError: CHANGELOG.md entry for ${version} is missing a date`);
    console.error(`Please update the header to: ${versionHeader} - ${new Date().toISOString().split('T')[0]}`);
    process.exit(1);
  }

  console.log(`✓ Changelog contains entry for ${version}`);
}

function checkGitStatus() {
  const status = exec('git status --porcelain', { silent: true, allowInDryRun: true });
  if (status && status.trim()) {
    console.error('\nError: Working directory is not clean');
    console.error('Please commit or stash your changes before releasing');
    console.error('\nUncommitted changes:');
    console.error(status);
    process.exit(1);
  }
  console.log('✓ Working directory is clean');
}

function checkBranch() {
  const branch = exec('git rev-parse --abbrev-ref HEAD', { silent: true, allowInDryRun: true }).trim();
  if (branch !== 'main' && branch !== 'master') {
    console.warn(`\nWarning: You are on branch '${branch}', not 'main' or 'master'`);
    console.warn('Releases are typically made from the main branch\n');
  }
}

function tagExists(tag) {
  try {
    exec(`git rev-parse ${tag}`, { silent: true, ignoreError: true, allowInDryRun: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('  Reqon Release Script');
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('\n** DRY RUN MODE - No changes will be made **\n');
  }

  const version = getPackageVersion();
  const tag = `v${version}`;

  console.log(`\nPreparing release: ${tag}`);

  // Preflight checks
  console.log('\n--- Preflight Checks ---');
  checkGitStatus();
  checkBranch();
  validateChangelog(version);

  if (tagExists(tag)) {
    console.error(`\nError: Tag ${tag} already exists`);
    console.error('Please update the version in package.json before releasing');
    console.error('\nTo bump version:');
    console.error('  npm run version:patch  # 0.2.0 -> 0.2.1');
    console.error('  npm run version:minor  # 0.2.0 -> 0.3.0');
    console.error('  npm run version:major  # 0.2.0 -> 1.0.0');
    process.exit(1);
  }
  console.log(`✓ Tag ${tag} does not exist yet`);

  // Run tests and build
  if (!skipTests) {
    console.log('\n--- Running Tests ---');
    exec('npm run test:run');

    console.log('\n--- Building ---');
    exec('npm run build');
  } else {
    console.log('\n--- Skipping tests (--skip-tests) ---');
  }

  // Create tag
  console.log('\n--- Creating Git Tag ---');
  exec(`git tag -a ${tag} -m "Release ${tag}"`);

  // Push tag
  console.log('\n--- Pushing Tag ---');
  exec(`git push origin ${tag}`);

  console.log('\n' + '='.repeat(50));
  console.log('  Release Complete!');
  console.log('='.repeat(50));
  console.log(`\nTag ${tag} has been pushed to GitHub.`);
  console.log('The GitHub Actions workflow will now:');
  console.log('  1. Run tests');
  console.log('  2. Build the package');
  console.log('  3. Publish to npm');
  console.log('  4. Create a GitHub release');
  console.log('\nMonitor progress at:');
  console.log('  https://github.com/mcclowes/reqon/actions');
}

main().catch((error) => {
  console.error('\nRelease failed:', error.message);
  process.exit(1);
});
