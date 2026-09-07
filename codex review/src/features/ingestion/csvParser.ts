/**
 * Ingestion Gateway - CSV / XLSX Parser & Validator
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
  acceptedRows: number;
  rejectedRows: number;
  errors: RowError[];
  parsedData: Array<{
    operating_date: string;
    block_index: number;
    start_time: string;
    end_time: string;
    load_kw: number;
    solar_generation_kw: number;
    actual_drawal_kw: number;
    scheduled_drawal_kw: number;
  }>;
}

// In-memory set of already processed checksums for local demo duplicate prevention
const PROCESSED_CHECKSUMS = new Set<string>();

export function computeFileChecksum(content: string): string {
  return CryptoJS.SHA256(content).toString();
}

export function parseAndValidateCsv(fileContent: string, siteId: string): ParseResult {
  const checksum = computeFileChecksum(fileContent);
  const isDuplicate = PROCESSED_CHECKSUMS.has(`${siteId}:${checksum}`);

  if (isDuplicate) {
    return {
      checksum,
      isDuplicate: true,
      totalRows: 0,
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

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for 1-based index, +1 for header row

    // 1. Validate operating date (YYYY-MM-DD)
    if (!row.operating_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.operating_date)) {
      errors.push({
        rowNumber: rowNum,
        column: 'operating_date',
        value: row.operating_date,
        reason: 'Invalid or missing date format. Expected YYYY-MM-DD.',
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

    // 4. Optional fields
    const solar = row.solar_generation_kw ? parseFloat(row.solar_generation_kw as string) : 0.0;
    const actual = row.actual_drawal_kw ? parseFloat(row.actual_drawal_kw as string) : load;
    const scheduled = row.scheduled_drawal_kw ? parseFloat(row.scheduled_drawal_kw as string) : load;

    const timings = getBlockTimes(block);

    acceptedData.push({
      operating_date: row.operating_date,
      block_index: block,
      start_time: timings.startTime,
      end_time: timings.endTime,
      load_kw: load,
      solar_generation_kw: isNaN(solar) ? 0.0 : Math.max(0, solar),
      actual_drawal_kw: isNaN(actual) ? load : Math.max(0, actual),
      scheduled_drawal_kw: isNaN(scheduled) ? load : Math.max(0, scheduled),
    });
  });

  // If no errors, record checksum as processed
  if (errors.length === 0 && acceptedData.length > 0) {
    PROCESSED_CHECKSUMS.add(`${siteId}:${checksum}`);
  }

  return {
    checksum,
    isDuplicate: false,
    totalRows: rows.length,
    acceptedRows: acceptedData.length,
    rejectedRows: errors.length,
    errors,
    parsedData: acceptedData,
  };
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
