import { describe, it, expect } from 'vitest';
import { parseAndValidateCsv, generateCsvTemplate, computeFileChecksum } from '@/features/ingestion/csvParser';

describe('CSV Parser, Idempotency & Ingestion Gateway', () => {
  const csvDays = (dates: string[], blocksPerDay = 96) => {
    const rows = ['operating_date,block_index,start_time,end_time,load_kw'];
    dates.forEach((date) => {
      for (let block = 1; block <= blocksPerDay; block++) {
        rows.push(`${date},${block},00:00,00:15,1000`);
      }
    });
    return rows.join('\n');
  };

  it('should successfully parse valid 96-block CSV template', () => {
    const template = generateCsvTemplate('2026-09-08');
    const result = parseAndValidateCsv(template, 'site-test-01');

    expect(result.isDuplicate).toBe(false);
    expect(result.totalRows).toBe(96);
    expect(result.daysDetected).toBe(1);
    expect(result.validDays).toBe(1);
    expect(result.validBlocks).toBe(96);
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
    expect(result.acceptedRows).toBe(0);
    expect(result.invalidDays).toBeGreaterThan(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some((e) => e.column === 'block_index')).toBe(true);
    expect(result.errors.some((e) => e.column === 'load_kw')).toBe(true);
    expect(result.errors.some((e) => e.column === 'operating_date')).toBe(true);
  });

  it('should reject impossible calendar dates (e.g. 2026-02-31, 2026-04-31, 2026-13-01)', () => {
    const csv = `operating_date,block_index,start_time,end_time,load_kw
2026-02-31,1,00:00,00:15,1200`;
    const result = parseAndValidateCsv(csv, 'site-test-calendar-date');
    expect(result.errors.some((e) => e.column === 'operating_date' && e.reason.includes('INVALID_CALENDAR_DATE'))).toBe(true);
  });

  it('accepts 192 rows containing two complete operating days', () => {
    const result = parseAndValidateCsv(csvDays(['2026-09-07', '2026-09-08']), 'site-192');
    expect(result.errors).toHaveLength(0);
    expect(result).toMatchObject({ totalRows: 192, daysDetected: 2, validDays: 2, validBlocks: 192, invalidDays: 0 });
  });

  it('structurally accepts 40,896 rows containing 426 complete operating days', () => {
    const start = Date.UTC(2024, 0, 1);
    const dates = Array.from({ length: 426 }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
    const result = parseAndValidateCsv(csvDays(dates), 'site-426-days');
    expect(result.errors).toHaveLength(0);
    expect(result).toMatchObject({ totalRows: 40896, daysDetected: 426, validDays: 426, validBlocks: 40896, invalidDays: 0 });
  });

  it('rejects a day containing only 95 blocks', () => {
    const result = parseAndValidateCsv(csvDays(['2026-09-08'], 95), 'site-95');
    expect(result.validDays).toBe(0);
    expect(result.invalidDays).toBe(1);
    expect(result.invalidRows).toBe(95);
    expect(result.errors.some((error) => error.reason.includes('INVALID_DAY_BLOCK_COUNT'))).toBe(true);
  });

  it('should reject duplicate and missing blocks in 96-row CSV', () => {
    const rows = ['operating_date,block_index,start_time,end_time,load_kw'];
    for (let b = 1; b <= 96; b++) {
      // Duplicate block 10, omit block 20
      const blk = b === 20 ? 10 : b;
      rows.push(`2026-09-08,${blk},00:00,00:15,1000`);
    }
    const res = parseAndValidateCsv(rows.join('\n'), 'site-dup-blocks');
    expect(res.errors.some((e) => e.reason.includes('DUPLICATE_BLOCK'))).toBe(true);
    expect(res.errors.some((e) => e.reason.includes('MISSING_BLOCK'))).toBe(true);
  });

  it('accepts valid trimmed YYYY-MM-DD dates without calendar errors', () => {
    const csv = csvDays(['2026-09-08']).replaceAll('2026-09-08', ' 2026-09-08 ');
    const result = parseAndValidateCsv(csv, 'site-trimmed-date');
    expect(result.errors).toHaveLength(0);
    expect(result.parsedData[0].operating_date).toBe('2026-09-08');
  });
});
