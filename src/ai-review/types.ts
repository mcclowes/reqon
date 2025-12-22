/**
 * Types for AI-powered documentation review
 */

export interface AIReviewConfig {
  /** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Model to use (defaults to claude-sonnet-4-20250514) */
  model?: string;
  /** GitHub token for API access (optional, for higher rate limits) */
  githubToken?: string;
  /** Vague repository (defaults to mcclowes/vague) */
  vagueRepo?: string;
  /** Output directory for reports */
  outputDir?: string;
  /** Verbose logging */
  verbose?: boolean;
}

export interface VagueDocumentation {
  /** README content */
  readme: string;
  /** CHANGELOG content */
  changelog?: string;
  /** Source files that define the DSL */
  sourceFiles: SourceFile[];
  /** Package.json for version info */
  packageJson?: Record<string, unknown>;
  /** Commit SHA fetched from */
  commitSha: string;
  /** Fetch timestamp */
  fetchedAt: Date;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface ReqonContext {
  /** Plugin file that registers Vague keywords */
  plugin: SourceFile;
  /** Parser files */
  parser: SourceFile[];
  /** AST node definitions */
  ast: SourceFile[];
  /** Lexer customizations */
  lexer: SourceFile[];
  /** Current package.json */
  packageJson: Record<string, unknown>;
  /** Current CLAUDE.md */
  claudeMd?: string;
}

export interface ReviewResult {
  /** Overall assessment */
  summary: string;
  /** Whether changes are needed */
  changesNeeded: boolean;
  /** Specific findings */
  findings: ReviewFinding[];
  /** Suggested actions */
  suggestedActions: SuggestedAction[];
  /** Vague version analyzed */
  vagueVersion: string;
  /** Reqon version analyzed */
  reqonVersion: string;
  /** Timestamp of review */
  reviewedAt: Date;
  /** Model used for analysis */
  model: string;
}

export interface ReviewFinding {
  /** Finding severity */
  severity: 'critical' | 'warning' | 'info';
  /** Category of finding */
  category: 'breaking-change' | 'new-feature' | 'deprecation' | 'documentation' | 'compatibility';
  /** Title of the finding */
  title: string;
  /** Detailed description */
  description: string;
  /** Related Vague file/section */
  vagueReference?: string;
  /** Related Reqon file/section */
  reqonReference?: string;
}

export interface SuggestedAction {
  /** Priority level */
  priority: 'high' | 'medium' | 'low';
  /** Action type */
  type: 'update' | 'add' | 'remove' | 'investigate' | 'test';
  /** Description of what to do */
  description: string;
  /** Affected files */
  affectedFiles?: string[];
  /** Estimated effort */
  effort?: 'small' | 'medium' | 'large';
}

export interface ReviewReport {
  /** Review result */
  result: ReviewResult;
  /** Vague documentation snapshot */
  vagueDoc: VagueDocumentation;
  /** Reqon context used */
  reqonContext: ReqonContext;
}
