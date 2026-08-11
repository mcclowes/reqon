import { describe, expect, it } from 'vitest';
import {
  buildDatasetReport,
  compareDatasetOutput,
  formatDatasetReport,
  reportFormatFromPath,
} from './index.js';

describe('Vague-backed pipeline reporting', () => {
  const data = {
    customers: [
      { id: 1, score: 10 },
      { id: 2, score: 20 },
    ],
  };

  it('builds field statistics for Reqon store output', () => {
    const report = buildDatasetReport(data, 'schema Customer { id: int, score: int }', 25);

    expect(report.summary).toMatchObject({ totalRecords: 2, totalCollections: 1 });
    expect(report.collections[0]).toMatchObject({ name: 'customers', recordCount: 2 });
    expect(JSON.parse(formatDatasetReport(report, 'json')).summary.totalRecords).toBe(2);
  });

  it('compares output with a golden dataset', () => {
    expect(compareDatasetOutput(data, data).result.identical).toBe(true);
    const comparison = compareDatasetOutput(data, { customers: [{ id: 1, score: 11 }] });
    expect(comparison.result.identical).toBe(false);
    expect(comparison.formatted).toContain('differences');
  });

  it('infers report format from the output extension', () => {
    expect(reportFormatFromPath('report.html')).toBe('html');
    expect(reportFormatFromPath('report.md')).toBe('markdown');
    expect(reportFormatFromPath('report.json')).toBe('json');
  });
});
