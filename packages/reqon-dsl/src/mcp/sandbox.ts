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

/** Default wall-clock budget for an untrusted mission execution. */
export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;

/** Thrown when an execution exceeds its allotted time budget. */
export class ExecutionTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Execution exceeded the ${timeoutMs}ms timeout`);
    this.name = 'ExecutionTimeoutError';
  }
}

/**
 * Race a promise against a timeout. An untrusted (LLM-supplied) mission could
 * otherwise loop or hang forever (e.g. a long pause/wait) and wedge the server.
 * On timeout the returned promise rejects with an {@link ExecutionTimeoutError};
 * the underlying work may keep running, but the caller is no longer blocked.
 *
 * A non-positive or non-finite timeout disables the guard.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExecutionTimeoutError(timeoutMs)), timeoutMs);
    // Don't let the timer keep the event loop alive on its own.
    (timer as { unref?: () => void }).unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Whether a store of the given type may be registered under the current effects
 * policy. File-backed stores write to disk, which is an effect, so they require
 * effects to be enabled. In-memory stores are always allowed.
 */
export function isStoreTypeAllowed(storeType: string | undefined, allowEffects: boolean): boolean {
  if (storeType === 'file') return allowEffects;
  return true;
}
