import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PostgRESTStore, PostgRESTError } from './postgrest.js';

// Mock global fetch
const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('PostgRESTStore', () => {
  let store: PostgRESTStore;

  const defaultOptions = {
    url: 'https://test.supabase.co/rest/v1',
    apiKey: 'test-api-key',
    table: 'users',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PostgRESTStore(defaultOptions);
  });

  describe('constructor', () => {
    it('normalizes URL by removing trailing slash', () => {
      const storeWithSlash = new PostgRESTStore({
        ...defaultOptions,
        url: 'https://test.supabase.co/rest/v1/',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      storeWithSlash.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users',
        expect.any(Object)
      );
    });

    it('includes schema headers when specified', () => {
      const storeWithSchema = new PostgRESTStore({
        ...defaultOptions,
        schema: 'custom_schema',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      storeWithSchema.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept-Profile': 'custom_schema',
            'Content-Profile': 'custom_schema',
          }),
        })
      );
    });
  });

  describe('get', () => {
    it('fetches a record by primary key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '123', name: 'Alice' }],
      });

      const result = await store.get('123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users?id=eq.123&limit=1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            apikey: 'test-api-key',
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
      expect(result).toEqual({ id: '123', name: 'Alice' });
    });

    it('returns null when record not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('URL-encodes special characters in key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await store.get('key with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users?id=eq.key%20with%20spaces&limit=1',
        expect.any(Object)
      );
    });

    it('throws PostgRESTError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(store.get('123')).rejects.toThrow(PostgRESTError);
    });

    it('uses custom primary key', async () => {
      const customStore = new PostgRESTStore({
        ...defaultOptions,
        primaryKey: 'user_id',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await customStore.get('123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users?user_id=eq.123&limit=1',
        expect.any(Object)
      );
    });
  });

  describe('set', () => {
    it('upserts a record with merge-duplicates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '123', name: 'Alice' }],
      });

      await store.set('123', { name: 'Alice', email: 'alice@example.com' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Prefer: 'resolution=merge-duplicates,return=representation',
          }),
          body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', id: '123' }),
        })
      );
    });

    it('throws PostgRESTError on failure with error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid data format' }),
      });

      await expect(store.set('123', { name: 'Alice' })).rejects.toThrow('Invalid data format');
    });
  });

  describe('update', () => {
    it('patches a record', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '123', name: 'Updated' }],
      });

      await store.update('123', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users?id=eq.123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated' }),
        })
      );
    });

    it('throws PostgRESTError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      });

      await expect(store.update('123', { name: 'Updated' })).rejects.toThrow(PostgRESTError);
    });
  });

  describe('delete', () => {
    it('deletes a record by primary key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await store.delete('123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users?id=eq.123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('throws PostgRESTError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Not authorized' }),
      });

      await expect(store.delete('123')).rejects.toThrow(PostgRESTError);
    });
  });

  describe('list', () => {
    it('fetches all records without filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
      });

      const results = await store.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users',
        expect.any(Object)
      );
      expect(results).toHaveLength(2);
    });

    it('applies where filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '1', name: 'Alice', status: 'active' }],
      });

      await store.list({ where: { status: 'active' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=eq.active'),
        expect.any(Object)
      );
    });

    it('applies limit and offset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await store.list({ limit: 10, offset: 20 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });

    it('handles null values in where clause', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await store.list({ where: { deleted_at: null } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at=is.null'),
        expect.any(Object)
      );
    });

    it('handles numeric and boolean values in where clause', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await store.list({ where: { age: 30, active: true } });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('age=eq.30');
      expect(url).toContain('active=eq.true');
    });

    it('throws PostgRESTError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      await expect(store.list()).rejects.toThrow(PostgRESTError);
    });
  });

  describe('clear', () => {
    it('deletes all records using not.is.null filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await store.clear();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users?id=not.is.null',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('bulkInsert', () => {
    it('inserts multiple records at once', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await store.bulkInsert([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify([
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
          ]),
        })
      );
    });

    it('does nothing for empty array', async () => {
      await store.bulkInsert([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('count', () => {
    it('returns count from Content-Range header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          'Content-Range': '0-9/100',
        }),
        json: async () => [],
      });

      const count = await store.count();
      expect(count).toBe(100);
    });

    it('applies where filter to count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          'Content-Range': '0-4/5',
        }),
        json: async () => [],
      });

      await store.count({ where: { status: 'active' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=eq.active'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Prefer: 'count=exact',
          }),
        })
      );
    });

    it('falls back to array length when Content-Range unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        json: async () => [{ id: '1' }, { id: '2' }, { id: '3' }],
      });

      const count = await store.count();
      expect(count).toBe(3);
    });
  });

  describe('error handling', () => {
    it('parses JSON error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Detailed error message' }),
      });

      try {
        await store.set('123', { invalid: 'data' });
      } catch (error) {
        expect(error).toBeInstanceOf(PostgRESTError);
        expect((error as PostgRESTError).message).toContain('Detailed error message');
        expect((error as PostgRESTError).statusCode).toBe(400);
      }
    });

    it('falls back to statusText when JSON parsing fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      try {
        await store.get('123');
      } catch (error) {
        expect(error).toBeInstanceOf(PostgRESTError);
        expect((error as PostgRESTError).message).toContain('Internal Server Error');
      }
    });
  });
});

describe('PostgRESTStore integration with factory', async () => {
  const { createStore } = await import('./factory.js');

  it('creates PostgRESTStore via factory', () => {
    const store = createStore({
      type: 'postgrest',
      name: 'users',
      postgrest: {
        url: 'https://test.supabase.co/rest/v1',
        apiKey: 'test-key',
      },
    });

    expect(store).toBeInstanceOf(PostgRESTStore);
  });

  it('creates PostgRESTStore when sql type has postgrest options', () => {
    const store = createStore({
      type: 'sql',
      name: 'users',
      postgrest: {
        url: 'https://test.supabase.co/rest/v1',
        apiKey: 'test-key',
      },
    });

    expect(store).toBeInstanceOf(PostgRESTStore);
  });

  it('throws when postgrest type missing options', () => {
    expect(() =>
      createStore({
        type: 'postgrest',
        name: 'users',
      })
    ).toThrow("PostgREST store requires 'postgrest' options");
  });
});
