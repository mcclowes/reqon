import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReviewReporter } from './reporter.js';
import type { ReviewResult, ReviewReport, ReviewFinding, SuggestedAction } from './types.js';

describe('ReviewReporter', () => {
  const testOutputDir = '/tmp/reqon-test-reports';

  beforeEach(async () => {
    await mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testOutputDir, { recursive: true, force: true });
  });

  const mockResult: ReviewResult = {
    summary: 'Test review completed successfully',
    changesNeeded: true,
    findings: [
      {
        severity: 'warning',
        category: 'new-feature',
        title: 'New expression syntax',
        description: 'Vague added new pipe operator support',
        vagueReference: 'src/parser/parser.ts',
        reqonReference: 'src/parser/parser.ts',
      },
      {
        severity: 'critical',
        category: 'breaking-change',
        title: 'Token type renamed',
        description: 'IDENTIFIER changed to IDENT',
      },
    ],
    suggestedActions: [
      {
        priority: 'high',
        type: 'update',
        description: 'Update token references',
        affectedFiles: ['src/lexer/keywords.ts'],
        effort: 'small',
      },
      {
        priority: 'medium',
        type: 'add',
        description: 'Add pipe operator support',
        effort: 'medium',
      },
    ],
    vagueVersion: '3.4.0',
    reqonVersion: '0.2.0',
    reviewedAt: new Date('2024-01-15T10:30:00.000Z'),
    model: 'claude-sonnet-4-20250514',
  };

  const mockReport: ReviewReport = {
    result: mockResult,
    vagueDoc: {
      readme: 'Test README',
      sourceFiles: [],
      commitSha: 'abc123',
      fetchedAt: new Date('2024-01-15T10:00:00.000Z'),
    },
    reqonContext: {
      plugin: { path: 'src/plugin.ts', content: 'test' },
      parser: [],
      ast: [],
      lexer: [],
      packageJson: { version: '0.2.0' },
    },
  };

  describe('saveReport and loadReport', () => {
    it('should save and load a report', async () => {
      const reporter = new ReviewReporter({ outputDir: testOutputDir });

      const filepath = await reporter.saveReport(mockReport);
      expect(filepath).toContain('review-');
      expect(filepath).toContain('.json');

      const filename = filepath.split('/').pop()!;
      const loaded = await reporter.loadReport(filename);

      expect(loaded.result.summary).toBe(mockResult.summary);
      expect(loaded.result.findings.length).toBe(2);
    });
  });

  describe('listReports', () => {
    it('should list saved reports', async () => {
      const reporter = new ReviewReporter({ outputDir: testOutputDir });

      await reporter.saveReport(mockReport);
      await reporter.saveReport({
        ...mockReport,
        result: { ...mockResult, reviewedAt: new Date('2024-01-16T10:30:00.000Z') },
      });

      const reports = await reporter.listReports();
      expect(reports.length).toBe(2);
      expect(reports[0]).toContain('review-');
    });

    it('should return empty array for non-existent directory', async () => {
      const reporter = new ReviewReporter({ outputDir: '/tmp/non-existent-dir' });
      const reports = await reporter.listReports();
      expect(reports).toEqual([]);
    });
  });

  describe('formatConsoleOutput', () => {
    it('should format result for console', () => {
      const reporter = new ReviewReporter({ outputDir: testOutputDir });
      const output = reporter.formatConsoleOutput(mockResult);

      expect(output).toContain('AI Documentation Review Report');
      expect(output).toContain('Test review completed successfully');
      expect(output).toContain('CHANGES NEEDED');
      expect(output).toContain('New expression syntax');
      expect(output).toContain('Token type renamed');
      expect(output).toContain('Update token references');
    });

    it('should show no changes needed when appropriate', () => {
      const reporter = new ReviewReporter({ outputDir: testOutputDir });
      const output = reporter.formatConsoleOutput({
        ...mockResult,
        changesNeeded: false,
        findings: [],
        suggestedActions: [],
      });

      expect(output).toContain('No changes needed');
    });
  });

  describe('formatMarkdown', () => {
    it('should format result as markdown', () => {
      const reporter = new ReviewReporter({ outputDir: testOutputDir });
      const output = reporter.formatMarkdown(mockResult);

      expect(output).toContain('# AI Documentation Review Report');
      expect(output).toContain('| Vague Version | 3.4.0 |');
      expect(output).toContain('## Findings');
      expect(output).toContain('### 🔴 Critical: Token type renamed');
      expect(output).toContain('### 🟡 Warning: New expression syntax');
      expect(output).toContain('## Suggested Actions');
      expect(output).toContain('- [ ] **🔺 High** [update]');
    });
  });
});
