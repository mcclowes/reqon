/**
 * Reporter for formatting and saving review results
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewReport, ReviewResult, ReviewFinding, SuggestedAction } from './types.js';

export interface ReporterConfig {
  outputDir: string;
  verbose?: boolean;
}

export class ReviewReporter {
  private config: ReporterConfig;

  constructor(config: ReporterConfig) {
    this.config = config;
  }

  /**
   * Save a review report to disk
   */
  async saveReport(report: ReviewReport): Promise<string> {
    await mkdir(this.config.outputDir, { recursive: true });

    const timestamp = report.result.reviewedAt.toISOString().replace(/[:.]/g, '-');
    const filename = `review-${timestamp}.json`;
    const filepath = join(this.config.outputDir, filename);

    await writeFile(filepath, JSON.stringify(report, null, 2));

    if (this.config.verbose) {
      console.log(`Report saved to: ${filepath}`);
    }

    return filepath;
  }

  /**
   * Load a previous report
   */
  async loadReport(filename: string): Promise<ReviewReport> {
    const filepath = join(this.config.outputDir, filename);
    const content = await readFile(filepath, 'utf-8');
    return JSON.parse(content) as ReviewReport;
  }

  /**
   * List all saved reports
   */
  async listReports(): Promise<string[]> {
    try {
      const files = await readdir(this.config.outputDir);
      return files.filter((f) => f.startsWith('review-') && f.endsWith('.json')).sort().reverse();
    } catch {
      return [];
    }
  }

  /**
   * Format a review result for console output
   */
  formatConsoleOutput(result: ReviewResult): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push('═'.repeat(60));
    lines.push('  AI Documentation Review Report');
    lines.push('═'.repeat(60));
    lines.push('');

    // Summary
    lines.push(`📋 Summary: ${result.summary}`);
    lines.push('');
    lines.push(`📦 Vague version: ${result.vagueVersion}`);
    lines.push(`📦 Reqon version: ${result.reqonVersion}`);
    lines.push(`🤖 Model: ${result.model}`);
    lines.push(`📅 Reviewed: ${result.reviewedAt.toISOString()}`);
    lines.push('');

    // Status
    if (result.changesNeeded) {
      lines.push('⚠️  CHANGES NEEDED');
    } else {
      lines.push('✅ No changes needed');
    }
    lines.push('');

    // Findings
    if (result.findings.length > 0) {
      lines.push('─'.repeat(60));
      lines.push('  Findings');
      lines.push('─'.repeat(60));

      for (const finding of result.findings) {
        lines.push('');
        lines.push(this.formatFinding(finding));
      }
      lines.push('');
    }

    // Suggested Actions
    if (result.suggestedActions.length > 0) {
      lines.push('─'.repeat(60));
      lines.push('  Suggested Actions');
      lines.push('─'.repeat(60));

      for (const action of result.suggestedActions) {
        lines.push('');
        lines.push(this.formatAction(action));
      }
      lines.push('');
    }

    lines.push('═'.repeat(60));

    return lines.join('\n');
  }

  /**
   * Format a single finding
   */
  private formatFinding(finding: ReviewFinding): string {
    const severityIcon = {
      critical: '🔴',
      warning: '🟡',
      info: '🔵',
    }[finding.severity];

    const categoryLabel = {
      'breaking-change': 'Breaking Change',
      'new-feature': 'New Feature',
      deprecation: 'Deprecation',
      documentation: 'Documentation',
      compatibility: 'Compatibility',
    }[finding.category];

    const lines = [
      `${severityIcon} [${categoryLabel}] ${finding.title}`,
      `   ${finding.description}`,
    ];

    if (finding.vagueReference) {
      lines.push(`   📍 Vague: ${finding.vagueReference}`);
    }
    if (finding.reqonReference) {
      lines.push(`   📍 Reqon: ${finding.reqonReference}`);
    }

    return lines.join('\n');
  }

  /**
   * Format a suggested action
   */
  private formatAction(action: SuggestedAction): string {
    const priorityIcon = {
      high: '🔺',
      medium: '🔸',
      low: '🔹',
    }[action.priority];

    const typeLabel = {
      update: 'Update',
      add: 'Add',
      remove: 'Remove',
      investigate: 'Investigate',
      test: 'Test',
    }[action.type];

    const effortLabel = action.effort ? ` (${action.effort} effort)` : '';

    const lines = [`${priorityIcon} [${typeLabel}]${effortLabel} ${action.description}`];

    if (action.affectedFiles && action.affectedFiles.length > 0) {
      lines.push(`   Files: ${action.affectedFiles.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Format as markdown for GitHub issues or PRs
   */
  formatMarkdown(result: ReviewResult): string {
    const lines: string[] = [];

    lines.push('# AI Documentation Review Report');
    lines.push('');
    lines.push(`**Summary:** ${result.summary}`);
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| Vague Version | ${result.vagueVersion} |`);
    lines.push(`| Reqon Version | ${result.reqonVersion} |`);
    lines.push(`| Model | ${result.model} |`);
    lines.push(`| Reviewed | ${result.reviewedAt.toISOString()} |`);
    lines.push(`| Changes Needed | ${result.changesNeeded ? '⚠️ Yes' : '✅ No'} |`);
    lines.push('');

    if (result.findings.length > 0) {
      lines.push('## Findings');
      lines.push('');

      for (const finding of result.findings) {
        const severityBadge = {
          critical: '🔴 Critical',
          warning: '🟡 Warning',
          info: '🔵 Info',
        }[finding.severity];

        lines.push(`### ${severityBadge}: ${finding.title}`);
        lines.push('');
        lines.push(`**Category:** ${finding.category}`);
        lines.push('');
        lines.push(finding.description);
        lines.push('');

        if (finding.vagueReference || finding.reqonReference) {
          lines.push('**References:**');
          if (finding.vagueReference) {
            lines.push(`- Vague: \`${finding.vagueReference}\``);
          }
          if (finding.reqonReference) {
            lines.push(`- Reqon: \`${finding.reqonReference}\``);
          }
          lines.push('');
        }
      }
    }

    if (result.suggestedActions.length > 0) {
      lines.push('## Suggested Actions');
      lines.push('');

      for (const action of result.suggestedActions) {
        const priorityBadge = {
          high: '🔺 High',
          medium: '🔸 Medium',
          low: '🔹 Low',
        }[action.priority];

        lines.push(`- [ ] **${priorityBadge}** [${action.type}] ${action.description}`);
        if (action.effort) {
          lines.push(`  - Effort: ${action.effort}`);
        }
        if (action.affectedFiles && action.affectedFiles.length > 0) {
          lines.push(`  - Files: ${action.affectedFiles.map((f) => `\`${f}\``).join(', ')}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
