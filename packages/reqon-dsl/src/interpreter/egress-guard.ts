/**
 * ---
 * purpose: Egress guard - blocks requests (and redirects) into private networks
 * exports:
 *   - guardFetch - wraps a fetch so every hop must resolve to a public address
 *   - assertPublicUrl - validates one URL's protocol, hostname and resolved IPs
 *   - isPrivateAddress - loopback/private/link-local/reserved IP check
 *   - EgressBlockedError - thrown for a blocked target; never retried
 * related:
 *   - ./http.ts - wraps the attempt's fetch when `blockPrivateNetworks` is on
 * ---
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type HostLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
export type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface EgressGuardOptions {
  /** Redirect hops to follow before failing (default 5). */
  maxRedirects?: number;
  /** Override DNS resolution (tests). */
  lookup?: HostLookup;
}

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressBlockedError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];
const DEFAULT_MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

const defaultLookup: HostLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const embedded = embeddedIPv4(address);
  if (embedded) return blocked.check(embedded, 'ipv4');
  return blocked.check(address, 'ipv6');
}

/** IPv4 carried inside IPv4-mapped, IPv4-compatible, NAT64 or 6to4 IPv6 addresses. */
function embeddedIPv4(address: string): string | undefined {
  const hextets = expandIPv6(address);
  const zeros = (from: number, to: number) => hextets.slice(from, to).every((h) => h === 0);
  const v4 = (high: number, low: number) =>
    [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');

  if (zeros(0, 5) && (hextets[5] === 0xffff || hextets[5] === 0)) {
    // ::/128 and ::1 are handled by the IPv6 list, not as 0.0.0.x.
    if (hextets[5] === 0 && hextets[6] === 0) return undefined;
    return v4(hextets[6], hextets[7]);
  }
  if (hextets[0] === 0x64 && hextets[1] === 0xff9b && zeros(2, 6)) {
    return v4(hextets[6], hextets[7]);
  }
  if (hextets[0] === 0x2002) return v4(hextets[1], hextets[2]);
  return undefined;
}

function expandIPv6(address: string): number[] {
  let text = address.toLowerCase().split('%')[0];
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text =
      text.slice(0, -dotted[1].length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (part?: string) => (part ? part.split(':').map((h) => parseInt(h, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const fill = tail === undefined ? [] : new Array(8 - left.length - right.length).fill(0);
  return [...left, ...fill, ...right];
}

export async function assertPublicUrl(input: string | URL, lookup = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new EgressBlockedError(`Blocked invalid URL: ${String(input)}`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new EgressBlockedError(`Blocked protocol ${url.protocol} for ${url.origin}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new EgressBlockedError(`Blocked private host ${host}`);
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new EgressBlockedError(`Blocked private address ${host}`);
    return url;
  }

  const addresses = await lookup(host);
  const internal = addresses.find(({ address }) => isPrivateAddress(address));
  if (!addresses.length || internal) {
    throw new EgressBlockedError(
      `Blocked ${host}: resolves to private address ${internal?.address ?? '(none)'}`
    );
  }
  return url;
}

/**
 * Wrap a fetch so the target and every redirect hop must be public. Redirects
 * are followed here, not by fetch, so each Location is checked before it's hit.
 *
 * Doesn't pin the resolved IP to the socket, so a DNS answer that changes
 * between check and connect (rebinding) isn't covered.
 */
export function guardFetch(base: FetchFn, options: EgressGuardOptions = {}): FetchFn {
  const lookup = options.lookup ?? defaultLookup;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  return async (input, init = {}) => {
    let url = await assertPublicUrl(input, lookup);
    let request: RequestInit = { ...init };

    for (let hop = 0; ; hop++) {
      const response = await base(url.toString(), { ...request, redirect: 'manual' });
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || !location || init.redirect === 'manual') {
        return response;
      }
      void response.body?.cancel().catch(() => {});
      if (init.redirect === 'error') {
        throw new EgressBlockedError(`Unexpected redirect from ${url.origin}`);
      }
      if (hop >= maxRedirects) {
        throw new EgressBlockedError(
          `Too many redirects (over ${maxRedirects}) from ${url.origin}`
        );
      }

      const next = await assertPublicUrl(new URL(location, url), lookup);
      request = redirectedRequest(request, response.status, next.origin !== url.origin);
      url = next;
    }
  };
}

function redirectedRequest(
  request: RequestInit,
  status: number,
  crossOrigin: boolean
): RequestInit {
  const method = (request.method ?? 'GET').toUpperCase();
  const toGet =
    status === 303 ? method !== 'HEAD' : [301, 302].includes(status) && method === 'POST';
  const headers = new Headers(request.headers);
  if (crossOrigin) for (const name of CREDENTIAL_HEADERS) headers.delete(name);
  if (toGet) {
    headers.delete('content-type');
    headers.delete('content-length');
  }
  return {
    ...request,
    headers,
    ...(toGet ? { method: 'GET', body: undefined } : {}),
  };
}
