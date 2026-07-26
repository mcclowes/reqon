import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PostgRESTStore, PostgRESTError } from './postgrest.js';

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

const ok = () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });

/**
 * A single POST with an array body is the whole point: N rows, one round-trip,
 * instead of N POSTs. Postgres ON CONFLICT cannot touch the same row twice in
 * one statement, so duplicate keys within a batch must be collapsed first.
 */
describe('PostgRESTStore bulk methods', () => {
  let store: PostgRESTStore;
  const options = { url: 'https://test.supabase.co/rest/v1', apiKey: 'k', table: 'managers' };

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PostgRESTStore(options);
  });

  const bodyOf = (call: number) => JSON.parse(mockFetch.mock.calls[call][1].body);

  it('bulkUpsert sends one POST with an array body', async () => {
    mockFetch.mockResolvedValueOnce(ok());

    await store.bulkUpsert([
      { key: '1', value: { id: 1, name: 'a' } },
      { key: '2', value: { id: 2, name: 'b' } },
      { key: '3', value: { id: 3, name: 'c' } },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Prefer).toContain('resolution=merge-duplicates');
    const body = bodyOf(0);
    expect(body).toHaveLength(3);
    expect(body.map((r: { id: number }) => r.id)).toEqual([1, 2, 3]);
  });

  it('stamps the primary key from the record key', async () => {
    mockFetch.mockResolvedValueOnce(ok());

    await store.bulkSet([{ key: '42', value: { name: 'no-id-field' } }]);

    expect(bodyOf(0)[0]).toEqual({ name: 'no-id-field', id: '42' });
  });

  it('collapses duplicate keys within a batch (last write wins, merged)', async () => {
    mockFetch.mockResolvedValueOnce(ok());

    await store.bulkUpsert([
      { key: '1', value: { id: 1, a: 1 } },
      { key: '2', value: { id: 2 } },
      { key: '1', value: { id: 1, b: 2 } },
    ]);

    const body = bodyOf(0);
    expect(body).toHaveLength(2);
    const one = body.find((r: { id: number }) => r.id === 1);
    expect(one).toEqual({ id: 1, a: 1, b: 2 });
  });

  it('is a no-op for an empty batch (no request)', async () => {
    await store.bulkSet([]);
    await store.bulkUpsert([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a failed bulk write', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad' });

    await expect(store.bulkUpsert([{ key: '1', value: { id: 1 } }])).rejects.toThrow(
      PostgRESTError
    );
  });
});
