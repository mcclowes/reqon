import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicClient } from './anthropic-client.js';

describe('AnthropicClient', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with required config', () => {
      const client = new AnthropicClient({ apiKey: mockApiKey });
      expect(client.getModel()).toBe('claude-sonnet-4-20250514');
    });

    it('should use custom model when provided', () => {
      const client = new AnthropicClient({
        apiKey: mockApiKey,
        model: 'claude-3-opus-20240229',
      });
      expect(client.getModel()).toBe('claude-3-opus-20240229');
    });
  });

  describe('chat', () => {
    it('should make API request with correct parameters', async () => {
      const mockResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const client = new AnthropicClient({ apiKey: mockApiKey });
      const result = await client.chat('System prompt', [
        { role: 'user', content: 'Hello' },
      ]);

      expect(result).toBe('Hello!');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options?.method).toBe('POST');
      expect(options?.headers).toMatchObject({
        'Content-Type': 'application/json',
        'x-api-key': mockApiKey,
        'anthropic-version': '2023-06-01',
      });

      const body = JSON.parse(options?.body as string);
      expect(body.system).toBe('System prompt');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('should throw error on API failure', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'Invalid request' } }),
      } as Response);

      const client = new AnthropicClient({ apiKey: mockApiKey });

      await expect(
        client.chat('System', [{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow('Anthropic API error: Invalid request');
    });
  });

  describe('analyzeDocumentation', () => {
    it('should call chat with analysis prompt', async () => {
      const mockResponse = {
        id: 'msg_123',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: 'All good',
              changesNeeded: false,
              findings: [],
              suggestedActions: [],
            }),
          },
        ],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const client = new AnthropicClient({ apiKey: mockApiKey });
      const result = await client.analyzeDocumentation(
        'Vague context here',
        'Reqon context here'
      );

      expect(result).toContain('All good');
    });
  });
});
