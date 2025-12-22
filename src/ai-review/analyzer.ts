/**
 * Documentation analyzer that compares Vague docs with Reqon implementation
 */

import { AnthropicClient } from './anthropic-client.js';
import { VagueDocFetcher, fetchReqonContext } from './doc-fetcher.js';
import type {
  AIReviewConfig,
  VagueDocumentation,
  ReqonContext,
  ReviewResult,
  ReviewReport,
  ReviewFinding,
  SuggestedAction,
} from './types.js';

export class DocumentationAnalyzer {
  private config: Required<AIReviewConfig>;
  private anthropicClient: AnthropicClient;
  private docFetcher: VagueDocFetcher;

  constructor(config: AIReviewConfig = {}) {
    // Resolve config with defaults
    this.config = {
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: config.model ?? 'claude-sonnet-4-20250514',
      githubToken: config.githubToken ?? process.env.GITHUB_TOKEN ?? '',
      vagueRepo: config.vagueRepo ?? 'mcclowes/vague',
      outputDir: config.outputDir ?? '.reqon-data/ai-reviews',
      verbose: config.verbose ?? false,
    };

    if (!this.config.apiKey) {
      throw new Error(
        'Anthropic API key required. Set ANTHROPIC_API_KEY env var or pass apiKey in config.'
      );
    }

    this.anthropicClient = new AnthropicClient({
      apiKey: this.config.apiKey,
      model: this.config.model,
    });

    this.docFetcher = new VagueDocFetcher({
      repo: this.config.vagueRepo,
      token: this.config.githubToken,
      verbose: this.config.verbose,
    });
  }

  /**
   * Run a full documentation review
   */
  async review(baseDir: string = process.cwd()): Promise<ReviewReport> {
    if (this.config.verbose) {
      console.log('Starting AI documentation review...');
      console.log(`Model: ${this.config.model}`);
      console.log(`Vague repo: ${this.config.vagueRepo}`);
    }

    // Fetch Vague documentation
    if (this.config.verbose) {
      console.log('\nFetching Vague documentation...');
    }
    const vagueDoc = await this.docFetcher.fetchDocumentation();

    // Fetch Reqon context
    if (this.config.verbose) {
      console.log('Fetching Reqon implementation context...');
    }
    const reqonContext = await fetchReqonContext(baseDir);

    // Build context strings for AI analysis
    const vagueContextStr = this.buildVagueContext(vagueDoc);
    const reqonContextStr = this.buildReqonContext(reqonContext);

    // Run AI analysis
    if (this.config.verbose) {
      console.log('Running AI analysis...');
    }
    const analysisResponse = await this.anthropicClient.analyzeDocumentation(
      vagueContextStr,
      reqonContextStr
    );

    // Parse the AI response
    const result = this.parseAnalysisResponse(analysisResponse, vagueDoc, reqonContext);

    return {
      result,
      vagueDoc,
      reqonContext,
    };
  }

  /**
   * Build context string from Vague documentation
   */
  private buildVagueContext(doc: VagueDocumentation): string {
    const sections: string[] = [];

    // Add version info
    if (doc.packageJson) {
      sections.push(`### Vague Package Info
Version: ${doc.packageJson.version ?? 'unknown'}
Dependencies: ${JSON.stringify(doc.packageJson.dependencies ?? {}, null, 2)}`);
    }

    // Add README
    if (doc.readme) {
      sections.push(`### README.md
${doc.readme.slice(0, 5000)}${doc.readme.length > 5000 ? '\n...(truncated)' : ''}`);
    }

    // Add CHANGELOG (recent entries)
    if (doc.changelog) {
      const recentChangelog = doc.changelog.slice(0, 3000);
      sections.push(`### CHANGELOG.md (recent)
${recentChangelog}${doc.changelog.length > 3000 ? '\n...(truncated)' : ''}`);
    }

    // Add key source files
    for (const file of doc.sourceFiles) {
      const truncatedContent =
        file.content.length > 4000
          ? file.content.slice(0, 4000) + '\n...(truncated)'
          : file.content;
      sections.push(`### ${file.path}
\`\`\`typescript
${truncatedContent}
\`\`\``);
    }

    sections.push(`\nCommit SHA: ${doc.commitSha}`);
    sections.push(`Fetched at: ${doc.fetchedAt.toISOString()}`);

    return sections.join('\n\n');
  }

  /**
   * Build context string from Reqon implementation
   */
  private buildReqonContext(ctx: ReqonContext): string {
    const sections: string[] = [];

    // Add version info
    sections.push(`### Reqon Package Info
Version: ${ctx.packageJson.version ?? 'unknown'}
Vague dependency: ${(ctx.packageJson.dependencies as Record<string, string>)?.['vague-lang'] ?? 'unknown'}`);

    // Add CLAUDE.md for project context
    if (ctx.claudeMd) {
      sections.push(`### CLAUDE.md (Project Documentation)
${ctx.claudeMd.slice(0, 3000)}${ctx.claudeMd.length > 3000 ? '\n...(truncated)' : ''}`);
    }

    // Add plugin file
    sections.push(`### ${ctx.plugin.path}
\`\`\`typescript
${ctx.plugin.content}
\`\`\``);

    // Add parser files
    for (const file of ctx.parser.slice(0, 3)) {
      const truncatedContent =
        file.content.length > 3000
          ? file.content.slice(0, 3000) + '\n...(truncated)'
          : file.content;
      sections.push(`### ${file.path}
\`\`\`typescript
${truncatedContent}
\`\`\``);
    }

    // Add AST files
    for (const file of ctx.ast) {
      const truncatedContent =
        file.content.length > 3000
          ? file.content.slice(0, 3000) + '\n...(truncated)'
          : file.content;
      sections.push(`### ${file.path}
\`\`\`typescript
${truncatedContent}
\`\`\``);
    }

    // Add lexer files
    for (const file of ctx.lexer) {
      sections.push(`### ${file.path}
\`\`\`typescript
${file.content}
\`\`\``);
    }

    return sections.join('\n\n');
  }

  /**
   * Parse the AI analysis response into structured result
   */
  private parseAnalysisResponse(
    response: string,
    vagueDoc: VagueDocumentation,
    reqonContext: ReqonContext
  ): ReviewResult {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Return a fallback result if no JSON found
      return {
        summary: response.slice(0, 500),
        changesNeeded: false,
        findings: [],
        suggestedActions: [],
        vagueVersion: String(vagueDoc.packageJson?.version ?? 'unknown'),
        reqonVersion: String(reqonContext.packageJson.version ?? 'unknown'),
        reviewedAt: new Date(),
        model: this.anthropicClient.getModel(),
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        summary?: string;
        changesNeeded?: boolean;
        findings?: ReviewFinding[];
        suggestedActions?: SuggestedAction[];
      };

      return {
        summary: parsed.summary ?? 'Analysis completed',
        changesNeeded: parsed.changesNeeded ?? false,
        findings: parsed.findings ?? [],
        suggestedActions: parsed.suggestedActions ?? [],
        vagueVersion: String(vagueDoc.packageJson?.version ?? 'unknown'),
        reqonVersion: String(reqonContext.packageJson.version ?? 'unknown'),
        reviewedAt: new Date(),
        model: this.anthropicClient.getModel(),
      };
    } catch {
      // JSON parse failed, return with raw summary
      return {
        summary: response.slice(0, 500),
        changesNeeded: false,
        findings: [],
        suggestedActions: [],
        vagueVersion: String(vagueDoc.packageJson?.version ?? 'unknown'),
        reqonVersion: String(reqonContext.packageJson.version ?? 'unknown'),
        reviewedAt: new Date(),
        model: this.anthropicClient.getModel(),
      };
    }
  }
}
