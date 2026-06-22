/**
 * Sandboxing helpers for the MCP server.
 *
 * The MCP server is driven by an LLM acting on untrusted input, so missions
 * must not be able to reach the network/filesystem or escape the working
 * directory unless the operator explicitly opts in.
 */

import { resolve, sep } from 'node:path';

/**
 * Resolve an untrusted path against a base working directory and assert the
 * result stays inside it. Blocks `../` and absolute-path escapes.
 *
 * @throws if the resolved path escapes the working directory
 */
export function resolveWithinWorkingDir(workingDir: string, p: string): string {
  const base = resolve(workingDir);
  const resolved = resolve(base, p);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`Path "${p}" escapes the working directory`);
  }
  return resolved;
}

/**
 * Decide the effective dryRun for an execution. Effects (real network/fs) are
 * opt-in: when not allowed, force dryRun regardless of what the caller asked.
 */
export function resolveDryRun(allowEffects: boolean, requestedDryRun?: boolean): boolean {
  if (!allowEffects) return true;
  return requestedDryRun ?? false;
}
