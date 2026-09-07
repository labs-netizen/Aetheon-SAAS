import { describe, it, expect } from 'vitest';
import { parseAndValidateCsv, generateCsvTemplate, computeFileChecksum } from '@/features/ingestion/csvParser';

describe('CSV Parser, Idempotency & Ingestion Gateway', () => {
  it('should successfully parse valid 96-block CSV template', () => {
    const template = generateCsvTemplate('2026-09-08');
    const result = parseAndValidateCsv(template, 'site-test-01');

    expect(result.isDuplicate).toBe(false);
    expect(result.totalRows).toBe(96);
    expect(result.acceptedRows).toBe(96);
    expect(result.rejectedRows).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.parsedData[0].block_index).toBe(1);
    expect(result.parsedData[95].block_index).toBe(96);
  });

  it('should detect duplicate file submission via checksum', () => {
    const template = generateCsvTemplate('2026-09-09');
    const firstRun = parseAndValidateCsv(template, 'site-test-dup');
    expect(firstRun.isDuplicate).toBe(false);

    // Re-ingest exact same content
    const secondRun = parseAndValidateCsv(template, 'site-test-dup');
    expect(secondRun.isDuplicate).toBe(true);
    expect(secondRun.errors[0].reason).toContain('DUPLICATE_IMPORT');
  });

  it('should reject rows with invalid block numbers or negative load', () => {
    const invalidCsv = `operating_date,block_index,start_time,end_time,load_kw
2026-09-08,1,00:00,00:15,1200
2026-09-08,99,00:15,00:30,1200
2026-09-08,3,00:30,00:45,-50.0
invalid-date,4,00:45,01:00,1200`;

    const result = parseAndValidateCsv(invalidCsv, 'site-test-errors');
    expect(result.acceptedRows).toBe(1);
    expect(result.rejectedRows).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.some((e) => e.column === 'block_index')).toBe(true);
    expect(result.errors.some((e) => e.column === 'load_kw')).toBe(true);
    expect(result.errors.some((e) => e.column === 'operating_date')).toBe(true);
  });
});
