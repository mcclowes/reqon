/**
 * Anthropic API client for documentation review
 */

import { sleep } from '../utils/async.js';

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ContentBlock {
  type: 'text';
  text: string;
}

interface AnthropicError {
  type: string;
  message: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;
const API_BASE_URL = 'https://api.anthropic.com/v1';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

export class AnthropicClient {
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * Send a message to Claude and get a response
   */
  async chat(
    systemPrompt: string,
    messages: Message[]
  ): Promise<string> {
    const requestBody = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${API_BASE_URL}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(requestBody),
        });

        if (response.status === 429) {
          // Rate limited - wait and retry
          const retryAfter = response.headers.get('retry-after');
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
          await sleep(delay);
          continue;
        }

        if (response.status >= 500) {
          // Server error - retry
          if (attempt < MAX_RETRIES) {
            await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
            continue;
          }
        }

        if (!response.ok) {
          const errorData = (await response.json()) as { error: AnthropicError };
          throw new Error(
            `Anthropic API error: ${errorData.error?.message ?? response.statusText}`
          );
        }

        const data = (await response.json()) as AnthropicResponse;

        // Extract text from response
        const textContent = data.content.find((c) => c.type === 'text');
        if (!textContent) {
          throw new Error('No text content in Anthropic response');
        }

        return textContent.text;
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_RETRIES && this.isRetryableError(error)) {
          await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new Error('Failed to get response from Anthropic API');
  }

  /**
   * Analyze documentation with a structured prompt
   */
  async analyzeDocumentation(
    vagueContext: string,
    reqonContext: string
  ): Promise<string> {
    const systemPrompt = `You are an expert software engineer analyzing the relationship between two related codebases:

1. **Vague**: A DSL (Domain Specific Language) library that provides lexer, parser, and expression syntax
2. **Reqon**: A runtime/framework that extends Vague with execution semantics for data pipelines

Your task is to analyze the Vague documentation and source code, compare it with the Reqon implementation, and identify:
- Breaking changes in Vague that might affect Reqon
- New features in Vague that Reqon could leverage
- Deprecations in Vague that Reqon needs to address
- Documentation gaps or inconsistencies
- Compatibility issues

Provide your analysis in the following JSON format:
{
  "summary": "Brief overall assessment",
  "changesNeeded": true/false,
  "findings": [
    {
      "severity": "critical|warning|info",
      "category": "breaking-change|new-feature|deprecation|documentation|compatibility",
      "title": "Short title",
      "description": "Detailed description",
      "vagueReference": "Optional file/section reference",
      "reqonReference": "Optional file/section reference"
    }
  ],
  "suggestedActions": [
    {
      "priority": "high|medium|low",
      "type": "update|add|remove|investigate|test",
      "description": "What to do",
      "affectedFiles": ["optional", "file", "list"],
      "effort": "small|medium|large"
    }
  ]
}

Be thorough but concise. Focus on actionable findings.`;

    const userMessage = `Please analyze the following Vague documentation and Reqon implementation:

## Vague Documentation and Source
${vagueContext}

## Reqon Implementation
${reqonContext}

Provide your analysis in the JSON format specified.`;

    return this.chat(systemPrompt, [{ role: 'user', content: userMessage }]);
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors are retryable
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the model being used
   */
  getModel(): string {
    return this.model;
  }
}
