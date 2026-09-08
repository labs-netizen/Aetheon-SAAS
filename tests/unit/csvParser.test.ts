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

  it('should reject non-96 row files (95 rows, 97 rows, 192 rows)', () => {
    // 95 rows
    const rows95 = ['operating_date,block_index,start_time,end_time,load_kw'];
    for (let b = 1; b <= 95; b++) {
      rows95.push(`2026-09-08,${b},00:00,00:15,1000`);
    }
    const res95 = parseAndValidateCsv(rows95.join('\n'), 'site-95');
    expect(res95.errors.some((e) => e.reason.includes('EXACT_96_ROWS'))).toBe(true);

    // 97 rows
    const rows97 = ['operating_date,block_index,start_time,end_time,load_kw'];
    for (let b = 1; b <= 97; b++) {
      rows97.push(`2026-09-08,${b},00:00,00:15,1000`);
    }
    const res97 = parseAndValidateCsv(rows97.join('\n'), 'site-97');
    expect(res97.errors.some((e) => e.reason.includes('EXACT_96_ROWS'))).toBe(true);

    // 192 rows
    const rows192 = ['operating_date,block_index,start_time,end_time,load_kw'];
    for (let b = 1; b <= 192; b++) {
      rows192.push(`2026-09-08,${((b - 1) % 96) + 1},00:00,00:15,1000`);
    }
    const res192 = parseAndValidateCsv(rows192.join('\n'), 'site-192');
    expect(res192.errors.some((e) => e.reason.includes('EXACT_96_ROWS'))).toBe(true);
  });

  it('should reject multiple operating dates in one CSV', () => {
    const rows = ['operating_date,block_index,start_time,end_time,load_kw'];
    for (let b = 1; b <= 96; b++) {
      const d = b <= 48 ? '2026-09-08' : '2026-09-09';
      rows.push(`${d},${b},00:00,00:15,1000`);
    }
    const res = parseAndValidateCsv(rows.join('\n'), 'site-multi-dates');
    expect(res.errors.some((e) => e.reason.includes('V1_CONTRACT_SINGLE_DATE'))).toBe(true);
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
});

