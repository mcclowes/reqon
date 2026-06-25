import { describe, it, expect, afterEach } from 'vitest';
import { statSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTokenStore } from './token-store.js';

describe('FileTokenStore file permissions', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('persists the token file owner-only (0o600)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reqon-tokens-'));
    dirs.push(dir);
    const filePath = join(dir, 'tokens.json');

    const store = new FileTokenStore(filePath);
    await store.set('conn-1', { accessToken: 'secret-access', refreshToken: 'secret-refresh' });

    // Low 9 permission bits must be 0o600 (rw-------): not group/world readable.
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
