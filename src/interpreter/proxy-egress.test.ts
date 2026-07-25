import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MissionExecutor } from './executor.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';

/**
 * The sharded fan-out over real sockets and a real undici ProxyAgent.
 *
 * Everything else about the proxy pool is covered with an injected agent
 * factory and a stubbed fetch, which cannot see whether the dispatcher is one
 * the runtime's fetch will actually accept. It isn't, by default: Node's global
 * fetch is backed by its own bundled undici and rejects a dispatcher built by
 * the separately installed copy ("invalid onRequestStart method"), so every
 * proxied request fails. Only an end-to-end run catches that.
 *
 * The origin enforces a per-egress budget and answers 429 when it is exceeded,
 * so the assertion is the property that matters: the server never had to say no.
 */

const ID_COUNT = 24;
const BUDGET = 6; // requests per egress per window
const WINDOW_MS = 1000;

interface Origin {
  server: http.Server;
  port: number;
  rejected: () => number;
  served: () => number;
  lanes: () => string[];
}

function startOrigin(): Promise<Origin> {
  const hits = new Map<string, number[]>();
  let rejected = 0;
  let served = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/ids') {
      const ids = Array.from({ length: ID_COUNT }, (_, i) => ({ id: i + 1 }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ids));
    }

    const egress = String(req.headers['x-egress'] ?? 'direct');
    const now = Date.now();
    const lane = hits.get(egress) ?? [];
    while (lane.length > 0 && lane[0] <= now - WINDOW_MS) lane.shift();
    hits.set(egress, lane);

    if (lane.length >= BUDGET) {
      rejected++;
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      return res.end('{"error":"too many requests"}');
    }

    lane.push(now);
    served++;
    const id = Number(req.url?.split('/').filter(Boolean)[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        rejected: () => rejected,
        served: () => served,
        lanes: () => [...hits.keys()],
      })
    );
  });
}

/** Forward proxy that tags its traffic, standing in for one egress IP. */
function startProxy(label: string): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const target = new URL(req.url as string);
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, 'x-egress': label },
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port })
    );
  });
}

const close = (server: http.Server) => new Promise((r) => server.close(() => r(undefined)));

describe('proxy egress end to end', () => {
  let origin: Origin;
  let proxyA: { server: http.Server; port: number };
  let proxyB: { server: http.Server; port: number };

  beforeAll(async () => {
    [origin, proxyA, proxyB] = await Promise.all([
      startOrigin(),
      startProxy('proxy-a'),
      startProxy('proxy-b'),
    ]);
  });

  afterAll(async () => {
    await Promise.all([close(origin.server), close(proxyA.server), close(proxyB.server)]);
  });

  it('fans out through the pool without earning a single 429', async () => {
    // 240rpm per lane is 4/s, comfortably inside the origin's 6/s per egress.
    const text = `
      mission ProxyBudgets {
        source API {
          auth: none,
          base: "http://127.0.0.1:${origin.port}",
          proxy: [
            "http://127.0.0.1:${proxyA.port}",
            "http://127.0.0.1:${proxyB.port}"
          ],
          rateLimit: { strategy: throttle, fallbackRpm: 240 }
        }

        store ids: memory("ids")
        store entries: memory("entries")

        action LoadIds {
          get "/ids"
          store response -> ids { key: .id }
        }

        action FetchEach {
          for row in ids concurrency 8 {
            get "/entry/{row.id}/history"
            store response -> entries { key: .id, upsert: true }
          }
        }

        run LoadIds then FetchEach
      }
    `;

    const program = new ReqonParser(new ReqonLexer(text).tokenize()).parse();
    const result = await new MissionExecutor({}).execute(program);

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(origin.rejected()).toBe(0);
    expect(origin.served()).toBe(ID_COUNT);
    expect(await result.stores.get('entries')?.list()).toHaveLength(ID_COUNT);
    // Both proxies carried traffic, and none of it leaked out direct.
    expect(origin.lanes().sort()).toEqual(['proxy-a', 'proxy-b']);
  }, 30000);
});
