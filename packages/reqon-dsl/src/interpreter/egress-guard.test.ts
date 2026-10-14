import { describe, it, expect, vi } from 'vitest';
import {
  assertPublicUrl,
  guardFetch,
  isPrivateAddress,
  EgressBlockedError,
  type HostLookup,
} from './egress-guard.js';

const publicLookup: HostLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const lookupTo =
  (address: string, family = 4): HostLookup =>
  async () => [{ address, family }];

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

describe('isPrivateAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a9fe:a9fe',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    }
  );

  it('treats unparseable input as private', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('allows a public host', async () => {
    await expect(assertPublicUrl('https://example.com/feed', publicLookup)).resolves.toBeInstanceOf(
      URL
    );
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/'])(
    'rejects protocol %s',
    async (url) => {
      await expect(assertPublicUrl(url, publicLookup)).rejects.toThrow(EgressBlockedError);
    }
  );

  it.each(['http://localhost/', 'http://api.localhost/', 'http://127.0.0.1/', 'http://[::1]/'])(
    'rejects %s without resolving',
    async (url) => {
      const lookup = vi.fn(publicLookup);
      await expect(assertPublicUrl(url, lookup)).rejects.toThrow(EgressBlockedError);
      expect(lookup).not.toHaveBeenCalled();
    }
  );

  it('rejects a hostname that resolves to a private address', async () => {
    await expect(
      assertPublicUrl('https://evil.example/', lookupTo('169.254.169.254'))
    ).rejects.toThrow(/169\.254\.169\.254/);
  });

  it('rejects when any resolved address is private', async () => {
    const lookup: HostLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await expect(assertPublicUrl('https://mixed.example/', lookup)).rejects.toThrow(
      EgressBlockedError
    );
  });

  it('rejects an unparseable URL', async () => {
    await expect(assertPublicUrl('not a url', publicLookup)).rejects.toThrow(EgressBlockedError);
  });
});

describe('guardFetch', () => {
  it('keeps credentials on a same-origin redirect', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect(302, '/next'))
      .mockResolvedValueOnce(new Response('ok'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    await guarded('https://example.com/', { headers: { 'X-API-Key': 'key' } });

    expect(new Headers(base.mock.calls[1][1].headers).get('x-api-key')).toBe('key');
  });

  it('passes a public request through with manual redirects', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    const response = await guarded('https://example.com/a', { method: 'GET' });

    expect(await response.text()).toBe('ok');
    expect(base).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('blocks before sending when the target is private', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const guarded = guardFetch(base, { lookup: lookupTo('127.0.0.1') });

    await expect(guarded('https://sneaky.example/')).rejects.toThrow(EgressBlockedError);
    expect(base).not.toHaveBeenCalled();
  });

  it('follows a redirect to a public host', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect(302, '/moved'))
      .mockResolvedValueOnce(new Response('done'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    const response = await guarded('https://example.com/start');

    expect(await response.text()).toBe('done');
    expect(base.mock.calls[1][0]).toBe('https://example.com/moved');
  });

  it('blocks a redirect into a private network', async () => {
    const base = vi.fn().mockResolvedValueOnce(redirect(301, 'http://169.254.169.254/latest'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    await expect(guarded('https://example.com/')).rejects.toThrow(EgressBlockedError);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('caps the number of redirects', async () => {
    const base = vi.fn(async () => redirect(302, 'https://example.com/loop'));
    const guarded = guardFetch(base, { lookup: publicLookup, maxRedirects: 2 });

    await expect(guarded('https://example.com/loop')).rejects.toThrow(/redirect/i);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it('returns a redirect without a Location header as-is', async () => {
    const base = vi.fn(async () => new Response(null, { status: 304 }));
    const guarded = guardFetch(base, { lookup: publicLookup });

    expect((await guarded('https://example.com/')).status).toBe(304);
  });

  it('switches to GET without a body on a 303', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect(303, 'https://example.com/result'))
      .mockResolvedValueOnce(new Response('ok'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    await guarded('https://example.com/submit', { method: 'POST', body: '{}' });

    expect(base.mock.calls[1][1]).toMatchObject({ method: 'GET', body: undefined });
  });

  it('keeps method and body on a 307', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect(307, 'https://example.com/v2'))
      .mockResolvedValueOnce(new Response('ok'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    await guarded('https://example.com/v1', { method: 'POST', body: '{}' });

    expect(base.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('drops credentials when a redirect leaves the origin', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(redirect(302, 'https://other.example/'))
      .mockResolvedValueOnce(new Response('ok'));
    const guarded = guardFetch(base, { lookup: publicLookup });

    await guarded('https://example.com/', {
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'a=b',
        'X-API-Key': 'key',
        Accept: 'application/json',
      },
    });

    const headers = new Headers(base.mock.calls[1][1].headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
  });
});
