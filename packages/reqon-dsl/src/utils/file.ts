import { mkdir, readFile, access, readdir, unlink, rename, open } from 'node:fs/promises';
import { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Monotonic counter to keep concurrent temp-file names unique within a process.
let tmpCounter = 0;

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

/**
 * Ensure the parent directory of a file exists
 */
export async function ensureParentDirectory(filePath: string): Promise<void> {
  await ensureDirectory(dirname(filePath));
}

/**
 * Serialize data to JSON with proper formatting
 */
export function serialize(data: unknown, pretty = true): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * Atomically write a file: write to a temp file, fsync it, then rename over
 * the target. A crash or full disk mid-write leaves the original file intact
 * rather than truncating it (the rename is atomic on POSIX/NTFS).
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  mode?: number
): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${tmpCounter++}.tmp`;
  const handle = await open(tmpPath, 'w', mode);
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/** Synchronous counterpart to {@link writeFileAtomic} for flush/exit paths. */
export function writeFileAtomicSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.${tmpCounter++}.tmp`;
  const fd = openSync(tmpPath, 'w');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

/**
 * Write JSON data to a file atomically (durable against mid-write crashes).
 */
export async function writeJsonFile(
  filePath: string,
  data: unknown,
  pretty = true,
  mode?: number
): Promise<void> {
  await writeFileAtomic(filePath, serialize(data, pretty), mode);
}

/**
 * Read JSON data from a file.
 * Returns null only if the file is absent; throws if it exists but is corrupt
 * so a truncated/partial file is never silently treated as "empty".
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    throw new Error(`Corrupt JSON in ${filePath}: ${(err as Error).message}`, { cause: err });
  }
}

/**
 * List files in a directory with optional extension filter
 */
export async function listFiles(dir: string, extension?: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    const filtered = extension ? entries.filter((f) => f.endsWith(extension)) : entries;
    return filtered.map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Delete a file (silently ignores if file doesn't exist)
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // File doesn't exist, nothing to delete
  }
}

/**
 * Restore Date objects in a parsed JSON object
 * Mutates the object in place and returns it
 */
export function restoreDates<T extends Record<string, unknown>>(obj: T, dateFields: string[]): T {
  const mutableObj = obj as Record<string, unknown>;
  for (const field of dateFields) {
    if (field in mutableObj && mutableObj[field] !== null && mutableObj[field] !== undefined) {
      mutableObj[field] = new Date(mutableObj[field] as string | number);
    }
  }
  return obj;
}

/**
 * Restore Date objects in nested arrays
 */
export function restoreDatesInArray<T extends Record<string, unknown>>(
  arr: T[],
  dateFields: string[]
): T[] {
  for (const item of arr) {
    restoreDates(item, dateFields);
  }
  return arr;
}
