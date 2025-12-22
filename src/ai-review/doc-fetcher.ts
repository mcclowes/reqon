/**
 * Fetches Vague documentation from GitHub
 */

import { sleep } from '../utils/async.js';
import type { VagueDocumentation, SourceFile } from './types.js';

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_REPO = 'mcclowes/vague';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Key files to fetch from Vague repository
const KEY_FILES = [
  'README.md',
  'CHANGELOG.md',
  'package.json',
  'src/lexer/lexer.ts',
  'src/lexer/tokens.ts',
  'src/parser/parser.ts',
  'src/parser/types.ts',
  'src/ast/nodes.ts',
  'src/evaluator/evaluator.ts',
  'src/types/index.ts',
  'src/index.ts',
];

interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

interface GitHubRef {
  ref: string;
  node_id: string;
  url: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

export class VagueDocFetcher {
  private repo: string;
  private token?: string;
  private verbose: boolean;

  constructor(options: { repo?: string; token?: string; verbose?: boolean } = {}) {
    this.repo = options.repo ?? DEFAULT_REPO;
    this.token = options.token;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Fetch all Vague documentation and key source files
   */
  async fetchDocumentation(): Promise<VagueDocumentation> {
    if (this.verbose) {
      console.log(`Fetching Vague documentation from ${this.repo}...`);
    }

    // Get the latest commit SHA
    const commitSha = await this.getLatestCommitSha();
    if (this.verbose) {
      console.log(`Latest commit: ${commitSha}`);
    }

    // Fetch all key files in parallel
    const filePromises = KEY_FILES.map((path) => this.fetchFile(path));
    const files = await Promise.all(filePromises);

    // Organize the fetched content
    const readme = files.find((f) => f?.path === 'README.md')?.content ?? '';
    const changelog = files.find((f) => f?.path === 'CHANGELOG.md')?.content;
    const packageJsonFile = files.find((f) => f?.path === 'package.json');
    const packageJson = packageJsonFile
      ? (JSON.parse(packageJsonFile.content) as Record<string, unknown>)
      : undefined;

    // Filter to source files only
    const sourceFiles: SourceFile[] = files
      .filter((f): f is SourceFile => f !== null && f.path.startsWith('src/'))
      .map((f) => ({ path: f.path, content: f.content }));

    if (this.verbose) {
      console.log(`Fetched ${sourceFiles.length} source files`);
    }

    return {
      readme,
      changelog,
      sourceFiles,
      packageJson,
      commitSha,
      fetchedAt: new Date(),
    };
  }

  /**
   * Get the latest commit SHA from the default branch
   */
  private async getLatestCommitSha(): Promise<string> {
    const response = await this.githubRequest<GitHubRef>(
      `/repos/${this.repo}/git/ref/heads/main`
    );
    return response.object.sha;
  }

  /**
   * Fetch a single file from the repository
   */
  private async fetchFile(path: string): Promise<SourceFile | null> {
    try {
      const response = await this.githubRequest<GitHubContent>(
        `/repos/${this.repo}/contents/${path}`
      );

      if (response.type !== 'file' || !response.content) {
        return null;
      }

      // GitHub returns base64 encoded content
      const content = Buffer.from(response.content, 'base64').toString('utf-8');
      return { path, content };
    } catch (error) {
      if (this.verbose) {
        console.log(`Could not fetch ${path}: ${(error as Error).message}`);
      }
      return null;
    }
  }

  /**
   * Make a request to the GitHub API with retry logic
   */
  private async githubRequest<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'reqon-doc-review',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${GITHUB_API_BASE}${path}`, { headers });

        if (response.status === 404) {
          throw new Error(`Not found: ${path}`);
        }

        if (response.status === 403) {
          // Rate limited
          const resetTime = response.headers.get('x-ratelimit-reset');
          if (resetTime) {
            const waitTime = parseInt(resetTime, 10) * 1000 - Date.now();
            if (waitTime > 0 && waitTime < 60000) {
              await sleep(waitTime);
              continue;
            }
          }
          throw new Error('GitHub API rate limit exceeded');
        }

        if (response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY * Math.pow(2, attempt - 1));
            continue;
          }
        }

        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_RETRIES && this.isRetryableError(error)) {
          await sleep(RETRY_DELAY * Math.pow(2, attempt - 1));
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new Error('GitHub API request failed');
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Fetch local Reqon context for comparison
 */
export async function fetchReqonContext(
  baseDir: string
): Promise<{
  plugin: SourceFile;
  parser: SourceFile[];
  ast: SourceFile[];
  lexer: SourceFile[];
  packageJson: Record<string, unknown>;
  claudeMd?: string;
}> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { glob } = await import('node:fs/promises');

  async function readFileContent(path: string): Promise<string | null> {
    try {
      return await readFile(join(baseDir, path), 'utf-8');
    } catch {
      return null;
    }
  }

  async function readSourceFile(path: string): Promise<SourceFile | null> {
    const content = await readFileContent(path);
    return content ? { path, content } : null;
  }

  // Read key Reqon files
  const pluginContent = await readFileContent('src/plugin.ts');
  const plugin: SourceFile = {
    path: 'src/plugin.ts',
    content: pluginContent ?? '',
  };

  // Read parser files
  const parserFiles = [
    'src/parser/index.ts',
    'src/parser/parser.ts',
    'src/parser/mission-parser.ts',
    'src/parser/source-parser.ts',
    'src/parser/store-parser.ts',
    'src/parser/action-parser.ts',
  ];
  const parser = (await Promise.all(parserFiles.map(readSourceFile))).filter(
    (f): f is SourceFile => f !== null
  );

  // Read AST files
  const astFiles = ['src/ast/nodes.ts', 'src/ast/index.ts'];
  const ast = (await Promise.all(astFiles.map(readSourceFile))).filter(
    (f): f is SourceFile => f !== null
  );

  // Read lexer files
  const lexerFiles = ['src/lexer/index.ts', 'src/lexer/keywords.ts'];
  const lexer = (await Promise.all(lexerFiles.map(readSourceFile))).filter(
    (f): f is SourceFile => f !== null
  );

  // Read package.json
  const packageJsonContent = await readFileContent('package.json');
  const packageJson = packageJsonContent
    ? (JSON.parse(packageJsonContent) as Record<string, unknown>)
    : {};

  // Read CLAUDE.md
  const claudeMd = (await readFileContent('CLAUDE.md')) ?? undefined;

  return { plugin, parser, ast, lexer, packageJson, claudeMd };
}
