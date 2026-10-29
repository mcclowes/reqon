import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execute } from '../index.js';

let server: Server;
let base = '';
let hits = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ id: 1 }]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const mission = () => `
  mission Egress {
    source Api { auth: none, base: "${base}" }
    store out: memory("out")
    action Pull {
      get "/items" { retry: { maxAttempts: 3, backoff: constant, initialDelay: 1 } }
      store response -> out { key: .id }
    }
    run Pull
  }
`;

describe('blockPrivateNetworks', () => {
  it('fails the run without sending or retrying a request to a private address', async () => {
    hits = 0;
    const result = await execute(mission(), { blockPrivateNetworks: true });

    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message).join(' ')).toMatch(
      /private address 127\.0\.0\.1/
    );
    expect(hits).toBe(0);
  });

  it('leaves private addresses reachable when off', async () => {
    hits = 0;
    const result = await execute(mission());

    expect(result.success).toBe(true);
    expect(hits).toBe(1);
  });
});
