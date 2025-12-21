import { mkdir, readFile, writeFile, access, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
 * Write JSON data to a file
 */
export async function writeJsonFile(filePath: string, data: unknown, pretty = true): Promise<void> {
  await writeFile(filePath, serialize(data, pretty), 'utf-8');
}

/**
 * Read JSON data from a file
 * Returns null if file doesn't exist or is corrupted
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * List files in a directory with optional extension filter
 */
export async function listFiles(
  dir: string,
  extension?: string
): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    const filtered = extension
      ? entries.filter((f) => f.endsWith(extension))
      : entries;
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
export function restoreDates<T extends Record<string, unknown>>(
  obj: T,
  dateFields: string[]
): T {
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
