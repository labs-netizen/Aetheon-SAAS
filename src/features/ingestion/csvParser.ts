/**
 * Ingestion Gateway - CSV Parser & 96-Block Validator (CSV-only for V1)
 * Implements 96-block validation, duplicate detection via SHA-256, and row-level error reporting.
 */

import Papa from 'papaparse';
import CryptoJS from 'crypto-js';
import { getBlockTimes } from '@/lib/dates/blocks96';

export interface CsvIntervalRow {
  operating_date: string;
  block_index: string | number;
  start_time?: string;
  end_time?: string;
  load_kw: string | number;
  solar_generation_kw?: string | number;
  actual_drawal_kw?: string | number;
  scheduled_drawal_kw?: string | number;
}

export interface RowError {
  rowNumber: number;
  column?: string;
  value?: unknown;
  reason: string;
}

export interface ParseResult {
  checksum: string;
  isDuplicate: boolean;
  totalRows: number;
  daysDetected: number;
  validDays: number;
  validBlocks: number;
  invalidDays: number;
  invalidRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errors: RowError[];
  parsedData: Array<{
    operating_date: string;
    block_index: number;
    start_time: string;
    end_time: string;
    load_kw: number;
    solar_generation_kw: number | null;
    actual_drawal_kw: number | null;
    scheduled_drawal_kw: number | null;
  }>;
}

export const COMPLETENESS_THRESHOLD = 95.0;

// In-memory set of already processed checksums for local demo duplicate prevention
const PROCESSED_CHECKSUMS = new Set<string>();

export function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  return (
    dateObj.getUTCFullYear() === year &&
    dateObj.getUTCMonth() === month - 1 &&
    dateObj.getUTCDate() === day
  );
}

export function computeFileChecksum(content: string): string {
  return CryptoJS.SHA256(content).toString();
}

export function parseAndValidateCsv(
  fileContent: string,
  siteId: string,
  options: { checksumSource?: string; recordChecksum?: boolean } = {}
): ParseResult {
  const checksum = computeFileChecksum(options.checksumSource ?? fileContent);
  const isDuplicate = PROCESSED_CHECKSUMS.has(`${siteId}:${checksum}`);

  if (isDuplicate) {
    return {
      checksum,
      isDuplicate: true,
      totalRows: 0,
      daysDetected: 0,
      validDays: 0,
      validBlocks: 0,
      invalidDays: 0,
      invalidRows: 0,
      acceptedRows: 0,
      rejectedRows: 0,
      errors: [{
        rowNumber: 0,
        reason: 'DUPLICATE_IMPORT: This exact file has already been ingested for this site.',
      }],
      parsedData: [],
    };
  }

  const parseOutput = Papa.parse<CsvIntervalRow>(fileContent, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = parseOutput.data;
  const errors: RowError[] = [];
  const acceptedData: ParseResult['parsedData'] = [];
  const candidates: Array<{ rowNumber: number; data: ParseResult['parsedData'][number] }> = [];
  const detectedDates = new Set<string>();
  const parserRejectedRows = new Set<number>();

  parseOutput.errors.forEach((error) => {
    const rowNumber = typeof error.row === 'number' ? error.row + 2 : 0;
    if (rowNumber > 0) parserRejectedRows.add(rowNumber);
    errors.push({
      rowNumber,
      reason: `CSV_PARSE_ERROR: ${error.message}`,
    });
  });

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for 1-based index, +1 for header row

    // 1. Validate operating date calendar integrity (reject impossible calendar dates like 2026-02-31)
    const operatingDate = typeof row.operating_date === 'string' ? row.operating_date.trim() : '';
    if (operatingDate) detectedDates.add(operatingDate);
    if (!operatingDate || !isValidCalendarDate(operatingDate)) {
      errors.push({
        rowNumber: rowNum,
        column: 'operating_date',
        value: row.operating_date,
        reason: 'INVALID_CALENDAR_DATE: Invalid calendar date format or impossible date (e.g. 2026-02-31). Expected existing calendar YYYY-MM-DD.',
      });
      return;
    }

    // 2. Validate block index (1 to 96)
    const block = typeof row.block_index === 'number' ? row.block_index : parseInt(row.block_index, 10);
    if (isNaN(block) || block < 1 || block > 96) {
      errors.push({
        rowNumber: rowNum,
        column: 'block_index',
        value: row.block_index,
        reason: 'Block index must be an integer between 1 and 96.',
      });
      return;
    }

    // 3. Validate numeric load (>= 0)
    const load = typeof row.load_kw === 'number' ? row.load_kw : parseFloat(row.load_kw as string);
    if (isNaN(load) || load < 0) {
      errors.push({
        rowNumber: rowNum,
        column: 'load_kw',
        value: row.load_kw,
        reason: 'Load value must be a non-negative number.',
      });
      return;
    }

    // 4. Optional fields - DO NOT fabricate DSM data if missing
    const solar = row.solar_generation_kw !== undefined && row.solar_generation_kw !== '' ? parseFloat(row.solar_generation_kw as string) : null;
    const actual = row.actual_drawal_kw !== undefined && row.actual_drawal_kw !== '' ? parseFloat(row.actual_drawal_kw as string) : null;
    const scheduled = row.scheduled_drawal_kw !== undefined && row.scheduled_drawal_kw !== '' ? parseFloat(row.scheduled_drawal_kw as string) : null;

    for (const [column, value] of [
      ['solar_generation_kw', solar],
      ['actual_drawal_kw', actual],
      ['scheduled_drawal_kw', scheduled],
    ] as const) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        errors.push({
          rowNumber: rowNum,
          column,
          value: row[column],
          reason: `${column} must be a non-negative number when supplied.`,
        });
        return;
      }
    }

    const timings = getBlockTimes(block);

    if (parserRejectedRows.has(rowNum)) return;

    candidates.push({ rowNumber: rowNum, data: {
      operating_date: operatingDate,
      block_index: block,
      start_time: timings.startTime,
      end_time: timings.endTime,
      load_kw: load,
      solar_generation_kw: solar,
      actual_drawal_kw: actual,
      scheduled_drawal_kw: scheduled,
    } });
  });

  const rowsByDate = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => {
    const dayRows = rowsByDate.get(candidate.data.operating_date) || [];
    dayRows.push(candidate);
    rowsByDate.set(candidate.data.operating_date, dayRows);
  });

  const invalidDateKeys = new Set<string>();
  rowsByDate.forEach((dayRows, operatingDate) => {
    const seen = new Set<number>();
    let dayInvalid = dayRows.length !== 96;
    if (dayRows.length !== 96) {
      errors.push({
        rowNumber: 0,
        column: 'operating_date',
        value: operatingDate,
        reason: `INVALID_DAY_BLOCK_COUNT: Operating date ${operatingDate} must contain exactly 96 rows (received ${dayRows.length}).`,
      });
    }

    dayRows.forEach(({ rowNumber, data }) => {
      if (seen.has(data.block_index)) {
        dayInvalid = true;
        errors.push({
          rowNumber,
          column: 'block_index',
          value: data.block_index,
          reason: `DUPLICATE_BLOCK: Block ${data.block_index} appears multiple times for date ${operatingDate}.`,
        });
      }
      seen.add(data.block_index);
    });

    const missing: number[] = [];
    for (let b = 1; b <= 96; b++) {
      if (!seen.has(b)) {
        missing.push(b);
      }
    }
    if (missing.length > 0) {
      dayInvalid = true;
      errors.push({
        rowNumber: 0,
        column: 'block_index',
        value: operatingDate,
        reason: `MISSING_BLOCK: Operating date ${operatingDate} is missing block(s): ${missing.join(', ')}. Contract requires blocks 1 to 96 exactly once.`,
      });
    }

    if (dayInvalid) invalidDateKeys.add(operatingDate);
    else acceptedData.push(...dayRows.map(({ data }) => data));
  });

  const validDays = rowsByDate.size - invalidDateKeys.size;
  const invalidDetectedDates = [...detectedDates].filter((date) => !rowsByDate.has(date)).length;
  const invalidDays = invalidDateKeys.size + invalidDetectedDates;

  // If no errors, record checksum as processed
  if (options.recordChecksum !== false && errors.length === 0 && acceptedData.length > 0) {
    PROCESSED_CHECKSUMS.add(`${siteId}:${checksum}`);
  }

  return {
    checksum,
    isDuplicate: false,
    totalRows: rows.length,
    daysDetected: detectedDates.size,
    validDays,
    validBlocks: acceptedData.length,
    invalidDays,
    invalidRows: rows.length - acceptedData.length,
    acceptedRows: acceptedData.length,
    rejectedRows: rows.length - acceptedData.length,
    errors,
    parsedData: acceptedData,
  };
}

/**
 * Validate that an interval dataset forms a strictly contiguous 1-96 block set per operating date
 */
export function validate96BlockContiguity(data: ParseResult['parsedData']): {
  isContiguous: boolean;
  missingBlocksByDate: Record<string, number[]>;
} {
  const dates = [...new Set(data.map((d) => d.operating_date))];
  const missing: Record<string, number[]> = {};
  let allContiguous = true;

  if (dates.length === 0) {
    allContiguous = false;
  }

  for (const date of dates) {
    const dateRows = data.filter((d) => d.operating_date === date);
    const presentBlocks = new Set(dateRows.map((d) => d.block_index));
    const missingForDate: number[] = [];
    for (let b = 1; b <= 96; b++) {
      if (!presentBlocks.has(b)) {
        missingForDate.push(b);
      }
    }
    if (dateRows.length !== 96 || presentBlocks.size !== 96 || missingForDate.length > 0) {
      missing[date] = missingForDate;
      allContiguous = false;
    }
  }

  return { isContiguous: allContiguous, missingBlocksByDate: missing };
}

/**
 * Generate standard CSV template for Indian 96-block interval upload.
 */
export function generateCsvTemplate(operatingDate = '2026-09-08'): string {
  const rows = ['operating_date,block_index,start_time,end_time,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw'];
  for (let b = 1; b <= 96; b++) {
    const t = getBlockTimes(b);
    rows.push(`${operatingDate},${b},${t.startTime},${t.endTime},1250.0,0.0,1250.0,1200.0`);
  }
  return rows.join('\n');
}
