import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOAS, clearCache } from './loader.js';
import { validateResponse } from './validator.js';
import { generateMockData } from './mock-generator.js';
import type { OpenAPIV3 } from 'openapi-types';

const tmpDirs: string[] = [];

async function writeSpec(spec: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reqon-oas-'));
  tmpDirs.push(dir);
  const path = join(dir, 'spec.json');
  await writeFile(path, JSON.stringify(spec));
  return path;
}

afterEach(async () => {
  clearCache();
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('loadOAS SSRF protection', () => {
  const remoteRefSpec = {
    openapi: '3.0.0',
    info: { title: 'remote-ref', version: '1.0.0' },
    paths: {
      '/x': {
        get: {
          operationId: 'getX',
          responses: {
            '200': {
              description: 'ok',
              content: {
                // A remote $ref pointing at a closed port. If it were fetched,
                // dereference would throw a connection error.
                'application/json': {
                  schema: { $ref: 'http://127.0.0.1:1/evil.json#/EvilSchema' },
                },
              },
            },
          },
        },
      },
    },
  };

  it('does not fetch remote $refs by default', async () => {
    const path = await writeSpec(remoteRefSpec);
    // Resolves without attempting the network fetch (which would throw).
    const source = await loadOAS(path);
    expect(source.operations.has('getX')).toBe(true);
  });
});

describe('validateResponse ReDoS protection', () => {
  it('returns quickly for a pathological pattern against a long string', () => {
    const schema: OpenAPIV3.SchemaObject = { type: 'string', pattern: '^(a+)+$' };
    const value = 'a'.repeat(100_000) + '!';

    const start = Date.now();
    const result = validateResponse(value, schema);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.valid).toBe(false);
  });

  it('still validates normal-length strings against patterns', () => {
    const schema: OpenAPIV3.SchemaObject = { type: 'string', pattern: '^[a-z]+$' };
    expect(validateResponse('hello', schema).valid).toBe(true);
    expect(validateResponse('Hello1', schema).valid).toBe(false);
  });

  it('does not crash on an invalid regex pattern', () => {
    const schema: OpenAPIV3.SchemaObject = { type: 'string', pattern: '([' };
    expect(() => validateResponse('anything', schema)).not.toThrow();
  });
});

describe('extractBaseUrl server variable templating', () => {
  it('resolves server URL variable defaults', async () => {
    const path = await writeSpec({
      openapi: '3.0.0',
      info: { title: 't', version: '1.0.0' },
      servers: [
        {
          url: 'https://{host}/v1',
          variables: { host: { default: 'api.example.com' } },
        },
      ],
      paths: {},
    });
    const source = await loadOAS(path);
    expect(source.baseUrl).toBe('https://api.example.com/v1');
  });

  it('rejects a server URL variable with no default', async () => {
    const path = await writeSpec({
      openapi: '3.0.0',
      info: { title: 't', version: '1.0.0' },
      servers: [{ url: 'https://{host}/v1', variables: { host: {} } }],
      paths: {},
    });
    await expect(loadOAS(path)).rejects.toThrow(/no default/);
  });
});

describe('generateMockData cycle/depth guards', () => {
  it('does not stack overflow on a self-referential object schema', () => {
    const node: Record<string, unknown> = {
      type: 'object',
      properties: { value: { type: 'string' } },
    };
    (node.properties as Record<string, unknown>).child = node; // circular
    expect(() => generateMockData(node as OpenAPIV3.SchemaObject)).not.toThrow();
  });

  it('does not stack overflow on a self-referential allOf schema', () => {
    const node: Record<string, unknown> = { allOf: [] };
    (node.allOf as unknown[]).push(node); // allOf referencing itself
    expect(() => generateMockData(node as OpenAPIV3.SchemaObject)).not.toThrow();
  });
});
