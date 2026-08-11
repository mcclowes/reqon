/**
 * ---
 * purpose: Vague-backed reports and golden-dataset comparison for Reqon store output
 * related:
 *   - ../cli.ts - exposes reporting through command-line flags
 *   - vague-lang - owns report statistics and dataset diff semantics
 * ---
 */

import {
  compareDatasets,
  formatComparisonResult,
  formatReportAsHTML,
  formatReportAsJSON,
  formatReportAsMarkdown,
  generateReport,
  type DatasetComparisonResult,
  type GenerationReport,
  type ReportFormat,
} from 'vague-lang';

export function buildDatasetReport(
  data: Record<string, unknown[]>,
  schemaSource: string,
  durationMs: number
): GenerationReport {
  return generateReport(data, schemaSource, [], {
    includeFieldStats: true,
    includeDistributions: true,
    startTime: Date.now() - durationMs,
    endTime: Date.now(),
  });
}

export function formatDatasetReport(report: GenerationReport, format: ReportFormat): string {
  if (format === 'html') return formatReportAsHTML(report);
  if (format === 'markdown') return formatReportAsMarkdown(report);
  return formatReportAsJSON(report);
}

export function reportFormatFromPath(path: string): ReportFormat {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown';
  return 'json';
}

export function compareDatasetOutput(
  expected: Record<string, unknown[]>,
  actual: Record<string, unknown[]>
): { result: DatasetComparisonResult; formatted: string } {
  const result = compareDatasets(expected, actual);
  return { result, formatted: formatComparisonResult(result) };
}
