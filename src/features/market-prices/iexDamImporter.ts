import Papa from 'papaparse';
import { getBlockTimes } from '@/lib/dates/blocks96';

export type IexDateFormat = 'AUTO' | 'DD/MM/YYYY' | 'DD-MM-YYYY';

export interface IexDamPriceRow {
  delivery_date: string;
  block_index: number;
  time_start: string;
  time_end: string;
  mcp_rs_per_mwh: number;
}

export interface IexDamParseResult {
  valid: boolean;
  rows: IexDamPriceRow[];
  total_rows: number;
  total_days: number;
  errors: Array<{ row?: number; delivery_date?: string; code: string; message: string }>;
}

const normalizedHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

function canonicalDate(rawValue: unknown, format: IexDateFormat): string | null {
  const raw = String(rawValue ?? '').trim();
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = /^(\d{2})([/-])(\d{2})\2(\d{4})$/.exec(raw);
    if (!match) return null;
    if (format === 'AUTO' && Number(match[1]) <= 12 && Number(match[3]) <= 12) return null;
    if (format === 'DD/MM/YYYY' && match[2] !== '/') return null;
    if (format === 'DD-MM-YYYY' && match[2] !== '-') return null;
    day = Number(match[1]); month = Number(match[3]); year = Number(match[4]);
  }
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.getUTCFullYear() !== year! || date.getUTCMonth() + 1 !== month! || date.getUTCDate() !== day!) return null;
  return `${year!.toString().padStart(4, '0')}-${month!.toString().padStart(2, '0')}-${day!.toString().padStart(2, '0')}`;
}

function blockFromValue(rawValue: unknown): number | null {
  const raw = String(rawValue ?? '').trim().replace(/[–—]/g, '-');
  if (/^\d{1,2}$/.test(raw)) {
    const block = Number(raw);
    return block >= 1 && block <= 96 ? block : null;
  }
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes < 0 || minutes >= 1440 || minutes % 15 !== 0) return null;
  const block = minutes / 15 + 1;
  const expected = getBlockTimes(block);
  return expected.startTime === `${match[1].padStart(2, '0')}:${match[2]}` &&
    expected.endTime === `${match[3].padStart(2, '0')}:${match[4]}` ? block : null;
}

export function parseOfficialIexDamCsv(csv: string, dateFormat: IexDateFormat = 'AUTO'): IexDamParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: (header) => header.trim(), transform: (value) => value.trim(),
  });
  const errors: IexDamParseResult['errors'] = parsed.errors.map((error) => ({
    row: typeof error.row === 'number' ? error.row + 2 : undefined,
    code: 'CSV_PARSE_ERROR', message: error.message,
  }));
  const fields = parsed.meta.fields || [];
  const find = (...names: string[]) => fields.find((field) => names.includes(normalizedHeader(field)));
  const dateColumn = find('date');
  const blockColumn = find('timeblock');
  const mcpColumn = find('mcprsmwh', 'mcprspermwh');
  if (!dateColumn || !blockColumn || !mcpColumn) {
    errors.push({ code: 'INVALID_IEX_DAM_SCHEMA', message: 'Official IEX DAM columns Date, Time Block, and MCP (Rs/MWh) are required.' });
    return { valid: false, rows: [], total_rows: parsed.data.length, total_days: 0, errors };
  }

  const rows: IexDamPriceRow[] = [];
  parsed.data.forEach((source, index) => {
    const deliveryDate = canonicalDate(source[dateColumn], dateFormat);
    const blockIndex = blockFromValue(source[blockColumn]);
    const priceRaw = String(source[mcpColumn] ?? '').replace(/,/g, '').trim();
    const mcp = priceRaw === '' ? Number.NaN : Number(priceRaw);
    if (!deliveryDate) errors.push({ row: index + 2, code: 'INVALID_OR_AMBIGUOUS_DATE', message: `Invalid or ambiguous delivery date '${source[dateColumn]}'. Select the export date format when required.` });
    if (blockIndex === null) errors.push({ row: index + 2, delivery_date: deliveryDate || undefined, code: 'INVALID_TIME_BLOCK', message: `Invalid 15-minute Time Block '${source[blockColumn]}'.` });
    if (!Number.isFinite(mcp) || mcp < 0) errors.push({ row: index + 2, delivery_date: deliveryDate || undefined, code: 'INVALID_MCP', message: `MCP must be a non-negative Rs/MWh value.` });
    if (deliveryDate && blockIndex !== null && Number.isFinite(mcp) && mcp >= 0) {
      const times = getBlockTimes(blockIndex);
      rows.push({ delivery_date: deliveryDate, block_index: blockIndex, time_start: times.startTime, time_end: times.endTime, mcp_rs_per_mwh: mcp });
    }
  });

  const byDate = new Map<string, IexDamPriceRow[]>();
  for (const row of rows) byDate.set(row.delivery_date, [...(byDate.get(row.delivery_date) || []), row]);
  for (const [deliveryDate, dayRows] of byDate) {
    const blocks = new Set(dayRows.map((row) => row.block_index));
    if (dayRows.length !== 96 || blocks.size !== 96) {
      errors.push({ delivery_date: deliveryDate, code: blocks.size < dayRows.length ? 'DUPLICATE_TIME_BLOCK' : 'INCOMPLETE_96_BLOCK_DAY', message: `${deliveryDate} contains ${dayRows.length} rows and ${blocks.size} unique blocks; exactly 96 are required.` });
    }
  }
  return { valid: errors.length === 0, rows, total_rows: parsed.data.length, total_days: byDate.size, errors };
}
